<script lang="ts">
	import type { AnswerVia, GradeResult, ReviewItem } from '../types.ts';
	import { post, errMsg } from '../client/api.ts';
	import AnswerInput from './AnswerInput.svelte';
	import SpeakButton from './SpeakButton.svelte';
	import Markdown from './Markdown.svelte';
	import PromptText from './PromptText.svelte';
	import { FONT_LABELS, pickFont, prefs } from '../client/state.svelte.ts';
	import { askTutor, setScreenContext, tutor } from '../client/tutorContext.svelte.ts';
	import { aiUi } from '../client/ai.svelte.ts';
	import type { PromptFont } from '../types.ts';
	import { onMount, untrack } from 'svelte';
	import { keepAwake } from '../client/wakeLock.ts';
	import KanjiTrace from './KanjiTrace.svelte';
	import KanaHint from './KanaHint.svelte';
	import { toast } from '../client/toast.svelte.ts';
	import { writingGrade } from '../strokes.ts';
	import { recognize, speechRecognitionSupported } from '../client/voice.ts';
	import { speakMixed, stopSpeaking } from '../client/tts.ts';

	// Pantalla encendida mientras dura la sesión (repaso o mini-quiz de lección).
	onMount(() => keepAwake());

	let {
		items,
		source,
		requeueWrong = false,
		onfinish
	}: {
		items: ReviewItem[];
		source: 'review' | 'lesson';
		/** En lecciones, los fallos vuelven al final de la cola hasta acertarlos. */
		requeueWrong?: boolean;
		onfinish?: (stats: { correct: number; wrong: number }) => void;
	} = $props();

	// Copia local de la cola (los props iniciales se consumen una vez).
	let queue: ReviewItem[] = $state([]);
	let total = $state(0);
	$effect.pre(() => {
		queue = [...items];
		total = items.length;
	});

	let answer = $state('');
	let result: GradeResult | null = $state(null);
	/** Cómo se respondió la tarjeta actual (opciones: la nota no pasa de «Bien»). */
	let answeredVia: AnswerVia = $state('typed');
	let warn = $state('');
	let busy = $state(false);
	let started = Date.now();
	let correctCount = $state(0);
	let wrongCount = $state(0);
	let done = $state(0);
	let why = $state('');
	let whyLoading = $state(false);
	let shake = $state(false);
	/** Sube con cada tarjeta: las respuestas por voz que llegan tarde (de la anterior) se descartan. */
	let seq = $state(0);

	const current = $derived(queue[0]);
	const finished = $derived(queue.length === 0);
	/** Kana, componentes y gramática siempre en gótica; el resto, fuente variada para reconocer kanji «en la calle». */
	let font: PromptFont = $state('gothic');
	const rollFont = (it: ReviewItem | undefined) =>
		(font = it && ['kanji', 'vocab', 'sentence'].includes(it.itemType) ? pickFont() : 'gothic');
	$effect.pre(() => {
		if (queue.length && font === 'gothic') rollFont(queue[0]);
	});

	// ---------- Forma de responder: opciones, escribir o voz ----------

	/** Opciones donde también se puede escribir (por defecto, el ajuste `answerStyle`; se cambia aquí mismo). */
	let useChoices = $state(prefs.answerStyle === 'choice');
	const voiceOk = speechRecognitionSupported();
	const VOICE_KEY = 'sensei.review.voice';
	let voiceMode = $state(false);
	onMount(() => {
		try {
			voiceMode = voiceOk && localStorage.getItem(VOICE_KEY) === '1';
		} catch {
			/* sin almacenamiento: empieza apagado */
		}
	});
	/** Se responde hablando: lecturas (ja-JP) y significados (es-CL). Kana sueltos, gramática y trazos, no. */
	const canVoice = (it: ReviewItem) => it.answerMode === 'kana' || it.answerMode === 'meaning';
	/** Tras dos silencios seguidos, esta tarjeta se responde con opciones o escribiendo. */
	let voiceFallback = $state(false);
	/** El alumno detuvo la escucha / el avance automático. */
	let voicePaused = $state(false);
	let listening = $state(false);
	const showVoice = $derived(!!current && voiceMode && canVoice(current) && !voiceFallback);
	const showChoices = $derived(
		!!current && (current.answerMode === 'choice' || (!showVoice && useChoices && !!current.options?.length))
	);
	const canToggleChoices = $derived(
		!!current && current.answerMode !== 'choice' && current.answerMode !== 'trace' && !!current.options?.length && !showVoice
	);

	async function toggleChoices() {
		useChoices = !useChoices;
		const style = useChoices ? 'choice' : 'typed';
		prefs.answerStyle = style;
		try {
			await post('/api/settings', { answerStyle: style });
		} catch {
			/* se queda en esta sesión aunque no se guarde */
		}
	}

	function toggleVoice() {
		voiceMode = !voiceMode;
		voicePaused = false;
		voiceFallback = false;
		misses = 0;
		warn = '';
		try {
			localStorage.setItem(VOICE_KEY, voiceMode ? '1' : '0');
		} catch {
			/* sin almacenamiento: vale para esta sesión */
		}
		if (voiceMode)
			toast.info('Modo voz', {
				detail:
					'Di la respuesta: la lectura en japonés o el significado en español. Si no la sabes, di «no sé» (en lecturas, «わからない»). El reconocimiento lo hace el navegador (Chrome y Edge envían el audio a sus servidores).',
				key: 'voice-mode'
			});
		else stopListening();
	}

	// Tarjeta «sanguijuela» detectada al fallar: se ofrece cambiar de estrategia.
	type Leech = { cardId: number; prompt: string; itemType: string };
	let leech: Leech | null = $state(null);
	let leechMsg = $state('');
	let leechBusy = $state(false);
	let leechSimilar: { char: string; meaning: string; tip: string | null }[] = $state([]);

	async function treatLeech(action: 'pause' | 'mnemonic' | 'similar') {
		if (!leech) return;
		leechBusy = true;
		try {
			const r = await post<{ due?: number; meaning?: string; similar?: typeof leechSimilar }>('/api/leech', {
				cardId: leech.cardId,
				action,
				days: 7
			});
			if (action === 'pause') {
				toast.success(`Apartada hasta el ${new Date(r.due!).toLocaleDateString('es')}`, { detail: 'Volverá con la cabeza fresca.' });
				leech = null;
			} else if (action === 'mnemonic') leechMsg = `Nueva mnemotecnia: ${r.meaning}`;
			else leechSimilar = r.similar ?? [];
		} catch (e) {
			toast.error('No se pudo tratar la tarjeta', { detail: errMsg(e) });
		} finally {
			leechBusy = false;
		}
	}

	// Contexto para el tutor: la tarjeta actual y, si ya respondiste, tu respuesta.
	$effect(() => {
		if (!current) return;
		setScreenContext({
			kind: source === 'lesson' ? 'lesson' : 'review',
			label: `${source === 'lesson' ? 'quiz de lección' : 'repaso'} · ${current.prompt.replace(/\{([^|{}]+)\|[^{}]+\}/g, '$1').slice(0, 30)}`,
			data: {
				card: current.label,
				prompt: current.prompt,
				...(result
					? { student_answer: answer, correct: result.correct, expected: result.answers, confused_with: result.confusedWith ?? null }
					: { note: 'aún sin responder: no le des la respuesta' }),
				extra: current.extra?.meaning ?? null
			}
		});
	});

	// ---------- Voz (reconocimiento del navegador) ----------

	/** Alternativas del reconocedor para la respuesta actual (el servidor corrige con ellas). */
	let spoken: string[] = [];
	let rec: { stop: () => void } | null = null;
	let misses = 0;
	/** Tarjeta (seq) cuyo enunciado ya se leyó en voz alta: al reintentar no se repite. */
	let spokeFor = -1;

	function stopListening() {
		rec?.stop();
		rec = null;
		stopSpeaking();
	}

	/**
	 * Escucha una respuesta y la corrige. Lecturas en japonés; significados en español. Kanji en lo reconocido se acepta
	 * si es exactamente lo preguntado (service.ts `gradeAnswer`).
	 */
	async function listen(item: ReviewItem, run: { cancelled: boolean }): Promise<'ok' | 'silence' | 'retry' | 'error'> {
		listening = true;
		warn = '';
		const my = seq;
		const r = recognize(item.facet === 'reading' ? 'ja-JP' : 'es-CL');
		rec = r;
		let heard: string[];
		try {
			heard = await r.result;
		} catch (e) {
			const msg = errMsg(e);
			warn = msg === 'not-allowed' ? 'Sin permiso para el micrófono: actívalo en el navegador.' : `Sin reconocimiento de voz: ${msg}`;
			return 'error';
		} finally {
			listening = false;
			if (rec === r) rec = null;
		}
		if (run.cancelled || my !== seq || result) return 'retry';
		if (!heard.length) return 'silence';
		busy = true;
		try {
			const g = await post<GradeResult>('/api/grade', {
				itemType: item.itemType,
				itemKey: item.itemKey,
				facet: item.facet,
				alternatives: heard
			});
			if (run.cancelled || my !== seq) return 'retry';
			if (g.nearMiss) {
				warn = `Oí «${g.heard}»: esa es la lectura del kanji suelto; se pide la de la palabra completa.`;
				return 'retry';
			}
			spoken = heard;
			answer = g.heard ?? heard[0];
			answeredVia = 'voice';
			warn = '';
			result = g;
			return 'ok';
		} catch (e) {
			toast.error('No se pudo enviar la respuesta', { detail: errMsg(e) });
			return 'error';
		} finally {
			busy = false;
		}
	}

	/** 🎙 a mano (sin modo voz, o para reanudarlo tras una pausa o dos silencios). */
	async function micOnce() {
		if (!current || listening || result || busy) return;
		if (voiceMode) {
			voicePaused = false;
			voiceFallback = false;
			misses = 0;
			return;
		}
		const r = await listen(current, { cancelled: false });
		if (r === 'silence') warn = 'No te oí: prueba otra vez o responde de otra forma.';
	}

	/** Lo que se lee del enunciado en preguntas de significado (nunca en las de lectura: la delataría). */
	function promptSpeech(it: ReviewItem): string | null {
		if (it.facet !== 'meaning' || it.itemType === 'component') return null;
		if (it.itemType === 'vocab') return it.extra?.reading ?? null;
		return it.extra?.reading?.split('、')[0] ?? null;
	}

	// Ciclo del modo voz: (leer el enunciado) → escuchar → corregir. Un silencio vuelve a escuchar; dos, a opciones.
	let listenTick = $state(0);
	$effect(() => {
		void listenTick;
		if (!showVoice || result || voicePaused || !current) return;
		const item = current;
		const run = { cancelled: false };
		untrack(() => {
			const my = seq;
			void (async () => {
				const say = spokeFor !== my && prefs.ttsEnabled ? promptSpeech(item) : null;
				spokeFor = my;
				if (say) await speakMixed(say);
				if (run.cancelled) return;
				const r = await listen(item, run);
				if (run.cancelled) return;
				if (r === 'silence') {
					if (++misses >= 2) {
						voiceFallback = true;
						warn = 'No te escuché: responde aquí o toca 🎙 para volver a intentarlo.';
					} else listenTick++;
				} else if (r === 'retry') listenTick++;
				else if (r === 'error') voicePaused = true;
			})();
		});
		return () => {
			run.cancelled = true;
			stopListening();
		};
	});

	// Tras responder por voz: acierto → «Bien» y sigue; fallo → se lee la respuesta correcta y sigue (otra vez).
	$effect(() => {
		if (!result || answeredVia !== 'voice' || voicePaused || !current) return;
		const ok = result.correct;
		const text = result.answers[0];
		let timer: ReturnType<typeof setTimeout> | undefined;
		let cancelled = false;
		untrack(() => {
			void (async () => {
				if (!ok && prefs.ttsEnabled && text) await speakMixed(text);
				if (cancelled) return;
				timer = setTimeout(() => (ok ? next(3) : next()), ok ? 1200 : 2500);
			})();
		});
		return () => {
			cancelled = true;
			clearTimeout(timer);
			stopSpeaking();
		};
	});

	// ---------- Responder y calificar ----------

	function choose(opt: string) {
		if (result || busy) return;
		answer = opt;
		answeredVia = 'choice';
		check();
	}

	$effect(() => {
		if (finished && total > 0) onfinish?.({ correct: correctCount, wrong: wrongCount });
	});

	async function check() {
		if (!current || busy) return;
		if (result) return next(result.correct ? 3 : undefined);
		if (!answer.trim()) return;
		if (current.answerMode === 'trace') answeredVia = 'trace';
		else if (!showChoices) answeredVia = 'typed';
		busy = true;
		try {
			const r = await post<GradeResult>('/api/grade', {
				itemType: current.itemType,
				itemKey: current.itemKey,
				facet: current.facet,
				answer
			});
			if (r.nearMiss) {
				warn = 'Esa es la lectura del kanji suelto; se pide la de la palabra completa.';
				shake = true;
				setTimeout(() => (shake = false), 600);
				return;
			}
			if (current.answerMode === 'kana' && /[a-z]/i.test(answer)) {
				warn = 'Quedan letras sin convertir a kana.';
				return;
			}
			warn = '';
			result = r;
		} catch (e) {
			toast.error('No se pudo enviar la respuesta', { detail: errMsg(e) });
		} finally {
			busy = false;
		}
	}

	/** «No sé»: cuenta como fallo y muestra la respuesta (mejor que adivinar: el SRS la traerá pronto). */
	async function giveUp() {
		if (!current || result || busy) return;
		stopListening();
		answeredVia = showVoice ? 'voice' : showChoices ? 'choice' : 'typed';
		spoken = [];
		answer = '';
		busy = true;
		try {
			result = await post<GradeResult>('/api/grade', {
				itemType: current.itemType,
				itemKey: current.itemKey,
				facet: current.facet,
				answer: ''
			});
			warn = '';
		} catch (e) {
			toast.error('No se pudo mostrar la respuesta', { detail: errMsg(e) });
		} finally {
			busy = false;
		}
	}

	async function next(grade?: number, override = false) {
		if (!current || !result || busy) return;
		busy = true;
		try {
			const res = await post<{ leech?: boolean; cardId: number }>('/api/answer', {
				itemType: current.itemType,
				itemKey: current.itemKey,
				facet: current.facet,
				answer,
				...(answeredVia === 'voice' && spoken.length ? { alternatives: spoken } : {}),
				via: answeredVia,
				grade,
				override,
				durationMs: Date.now() - started,
				source
			});
			if (res.leech) {
				leech = { cardId: res.cardId, prompt: current.prompt, itemType: current.itemType };
				leechMsg = '';
				leechSimilar = [];
			}
			const ok = result.correct || override;
			const item = queue[0];
			queue = queue.slice(1);
			rollFont(queue[0]);
			if (ok) correctCount++;
			else {
				wrongCount++;
				if (requeueWrong) queue = [...queue, item];
			}
			if (ok || !requeueWrong) done++;
			seq++;
			answer = '';
			spoken = [];
			misses = 0;
			voiceFallback = false;
			result = null;
			why = '';
			warn = '';
			started = Date.now();
			// La tarjeta siguiente empieza arriba (la anterior pudo dejar la página o la explicación desplazadas).
			if (window.scrollY > 0) window.scrollTo({ top: 0 });
			if (middleEl) middleEl.scrollTop = 0;
		} catch (e) {
			toast.error('No se pudo enviar la respuesta', { detail: errMsg(e) });
		} finally {
			busy = false;
		}
	}

	async function explain() {
		if (!current || !result) return;
		whyLoading = true;
		try {
			const r = await post<{ text: string }>('/api/explain-mistake', {
				itemType: current.itemType,
				itemKey: current.itemKey,
				facet: current.facet,
				answer
			});
			why = r.text;
		} catch (e) {
			why = `No disponible: ${errMsg(e)}`;
		} finally {
			whyLoading = false;
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (busy || !current) return;
		// Escribiendo en otro campo (el chat del tutor, por ejemplo): las teclas no son atajos.
		const t = e.target as HTMLElement | null;
		if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
		if (!result) {
			// Opciones con 1-4 (no hay campo de texto que reciba las teclas).
			const i = Number(e.key) - 1;
			if (showChoices && current.options && i >= 0 && i < current.options.length) {
				e.preventDefault();
				choose(current.options[i]);
			}
			return;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			if (current.answerMode === 'trace') next(result.correct ? writingGrade(Number(answer)).grade : undefined);
			else next(result.correct ? 3 : undefined);
		} else if (result.correct && ['1', '2', '3'].includes(e.key)) {
			if (e.key === '3' && answeredVia === 'choice') return;
			e.preventDefault();
			next({ '1': 2, '2': 3, '3': 4 }[e.key]);
		}
	}

	// ---------- Zona del pulgar ----------
	// La sesión ocupa justo el alto disponible: enunciado arriba, explicación en el medio (con su propio scroll) y
	// respuesta + barra abajo, donde queda el dedo. Opciones y botones no se mueven entre tarjetas. La escritura (lienzo
	// alto) usa el flujo normal con la barra pegada abajo.
	let sessionEl: HTMLDivElement | undefined = $state();
	let middleEl: HTMLDivElement | undefined = $state();
	/** Distancia del inicio de la sesión al principio de la página (lo de arriba: cabecera, sesión de hoy…). */
	let topPx = $state(0);
	$effect(() => {
		const el = sessionEl;
		if (!el) return;
		const measure = () => {
			topPx = Math.round(el.getBoundingClientRect().top + window.scrollY);
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(document.body);
		window.addEventListener('resize', measure);
		return () => {
			ro.disconnect();
			window.removeEventListener('resize', measure);
		};
	});
	const fit = $derived(!!current && current.answerMode !== 'trace');

	// Al responder, los botones ocupan el sitio de las opciones y de la barra (que se quita): se mide ese alto justo
	// antes de que cambie el DOM ($effect.pre) para que nada salte y el dedo quede sobre un botón.
	let zoneEl: HTMLDivElement | undefined = $state();
	let keepH = $state(0);
	$effect.pre(() => {
		if (!result) {
			keepH = 0;
			return;
		}
		if (!fit || !zoneEl || !sessionEl) return;
		const zone = zoneEl;
		const session = sessionEl;
		untrack(() => {
			if (!keepH) keepH = Math.round(session.getBoundingClientRect().bottom - zone.getBoundingClientRect().top);
		});
	});
	/** Lo respondido se muestra en japonés en lecturas (y en el kana inverso). */
	const jpAnswer = $derived(
		!!current && (current.itemType === 'kana' ? current.facet === 'meaning' : current.facet === 'reading')
	);
	// El botón flotante del tutor taparía las opciones de abajo: mientras dura la sesión va en la cabecera.
	$effect(() => {
		if (finished) return;
		tutor.fabHidden = true;
		return () => (tutor.fabHidden = false);
	});
</script>

<svelte:window {onkeydown} />

{#if finished}
	<div class="card done">
		<h2>¡Terminado! 🎉</h2>
		<p>{correctCount} aciertos · {wrongCount} fallos</p>
	</div>
{:else if current}
	<div class="session" class:fit bind:this={sessionEl} style:--top="{topPx}px">
		<div class="progress"><div style="width:{(done / Math.max(1, total)) * 100}%"></div></div>
		<div class="spread small muted">
			<span>{done} / {total}</span>
			<span class="row tight">
				<span>✓ {correctCount} · ✗ {wrongCount}</span>
				{#if voiceOk}
					<button
						class="small ghost voice-toggle"
						class:on={voiceMode}
						onclick={toggleVoice}
						aria-pressed={voiceMode}
						title="Modo voz: dices la respuesta y pasa sola a la siguiente">🗣 Voz{voiceMode ? ' ✓' : ''}</button
					>
				{/if}
				{#if aiUi()}
					<button class="small ghost" onclick={() => (tutor.open = true)} title="Preguntar al tutor (sabe qué tarjeta estás viendo)" aria-label="Abrir tutor"
						><span class="jp">話</span> Tutor</button
					>
				{/if}
			</span>
		</div>

		<div class="prompt type-{current.itemType} facet-{current.facet}" class:compact={!!result && fit}>
			{#if current.answerMode === 'trace'}
				<span class="sentence">✍ {current.prompt}</span>
			{:else if current.itemType === 'kana' && current.facet === 'meaning'}
				<!-- Inversa: el sonido (romaji y voz); se elige el kana. -->
				<span class="big romaji">{current.prompt}</span>
				<SpeakButton text={current.itemKey} />
			{:else if current.itemType === 'grammar' || current.itemType === 'sentence'}
				<span class="jp sentence"><PromptText text={current.prompt} highlight={current.highlight} {font} /></span>
			{:else}
				<span class="jp big f-{font}">{current.prompt}</span>
			{/if}
		</div>
		<div class="label facet-{current.facet}">
			{current.label}
			{#if font !== 'gothic'}<span class="fontname">· fuente {FONT_LABELS[font]}</span>{/if}
		</div>

		<!-- Respuesta: abajo, junto a la barra (en el DOM va antes de la explicación; el orden visual lo da el CSS). -->
		<div class="answer-zone" bind:this={zoneEl} style:min-height={keepH ? `${keepH}px` : undefined}>
		{#if current.answerMode === 'trace'}
			<!-- Escritura: de memoria; al terminar, los fallos de trazo deciden la nota (strokes.ts → writingGrade). -->
			{#key current.cardId ?? current.itemKey}
				<KanjiTrace
					char={current.itemKey}
					guided={false}
					onfinish={(r) => {
						if (result) return;
						answer = String(r.mistakes);
						void check();
					}}
				/>
			{/key}
			{#if current.extra?.reading && !result}<p class="small muted center jp">Lectura: {current.extra.reading}</p>{/if}
		{/if}
		{#if result}
			<!-- Tras responder, en el sitio de las opciones (donde quedó el dedo): lo respondido y los botones grandes. -->
			<div class="verdict" class:ok={result.correct} class:bad={!result.correct}>
				<span>{result.correct ? '✓' : '✗'}</span>
				{#if current.answerMode === 'trace'}
					<span>{Number(answer) ? `${answer} trazo(s) fallado(s)` : 'Sin fallos'}</span>
				{:else if result.gaveUp || !answer}
					<span>No sé</span>
				{:else}
					<span class:jp={jpAnswer}>{answeredVia === 'voice' ? `Oí «${answer}»` : answer}</span>
				{/if}
				{#if !result.correct && current.answerMode !== 'trace' && result.answers[0]}
					<span class="muted">→</span><span class:jp={jpAnswer}>{result.answers[0]}</span>
				{/if}
			</div>
			{#if current.answerMode === 'trace'}
				<!-- La nota sale de los fallos de trazo: 0 = Bien, 1-2 = Difícil, 3+ = otra vez. -->
				<button class="act primary" onclick={() => next(result?.correct ? writingGrade(Number(answer)).grade : undefined)} disabled={busy}>Continuar <kbd>↵</kbd></button>
			{:else if result.correct}
				<button class="act primary" onclick={() => next(3)} disabled={busy}>Bien <kbd>2/↵</kbd></button>
				<button class="act" onclick={() => next(2)} disabled={busy}>Difícil <kbd>1</kbd></button>
				{#if answeredVia !== 'choice'}
					<button class="act" onclick={() => next(4)} disabled={busy}>Fácil <kbd>3</kbd></button>
				{/if}
			{:else}
				<button class="act primary" onclick={() => next()} disabled={busy}>Continuar <kbd>↵</kbd></button>
				{#if !result.gaveUp}
					<button class="act" onclick={() => next(3, true)} disabled={busy} title="Errata o sinónimo válido">Contar como correcta</button>
				{/if}
			{/if}
			{#if answeredVia === 'voice' && !voicePaused}
				<button class="act ghost" onclick={() => (voicePaused = true)} title="Quedarse en esta tarjeta">⏸ Pausa</button>
			{/if}
		{:else if current.answerMode === 'trace'}
			<!-- La respuesta es el lienzo de arriba. -->
		{:else if showVoice}
			<div class="voice-box" class:on={listening}>
				{#if listening}
					🎙 {current.facet === 'reading' ? 'Di la lectura…' : 'Di el significado en español…'}
				{:else if voicePaused}
					Voz en pausa
				{:else}
					…
				{/if}
			</div>
		{:else if showChoices && current.options}
			<div class="choices">
				{#each current.options as opt, i (opt)}
					<button
						class="choice"
						class:jp={current.itemType === 'kana' ? current.facet === 'meaning' : current.facet === 'reading'}
						class:kana-opt={current.itemType === 'kana' && current.facet === 'meaning'}
						disabled={busy}
						onclick={() => choose(opt)}><kbd class="num">{i + 1}</kbd>{opt}</button
					>
				{/each}
			</div>
		{:else}
			<div class:shake class="answer-row">
				<AnswerInput
					bind:value={answer}
					mode={current.answerMode}
					disabled={busy}
					status={warn ? 'warn' : 'idle'}
					onsubmit={check}
				/>
			</div>
			{#if listening}<div class="small muted center">🎙 {current.facet === 'reading' ? 'Di la lectura…' : 'Di el significado…'}</div>{/if}
		{/if}
		</div>

		<!-- Medio: avisos y explicación, con su propio scroll (antes de responder, espacio libre). -->
		<div class="middle" class:idle={!result && !leech && !warn} bind:this={middleEl}>
		{#if leech}
			<div class="card leech stack small">
				<div class="spread">
					<strong>«<span class="jp">{leech.prompt}</span>» se te resiste</strong>
					<button class="ghost small" onclick={() => (leech = null)}>Seguir</button>
				</div>
				<p class="muted">
					Lo has fallado muchas veces. Repetirlo igual no funciona: cambia de estrategia.
				</p>
				<div class="row">
					{#if leech.itemType === 'kanji'}
						{#if aiUi()}<button class="small" onclick={() => treatLeech('mnemonic')} disabled={leechBusy}>Nueva mnemotecnia personalizada</button>{/if}
						<button class="small" onclick={() => treatLeech('similar')} disabled={leechBusy}>¿Con qué lo confundo?</button>
					{/if}
					<button class="small" onclick={() => treatLeech('pause')} disabled={leechBusy}>Apartarla 7 días</button>
					{#if leechBusy}<span class="spinner"></span>{/if}
				</div>
				{#if leechMsg}<Markdown text={leechMsg} />{/if}
				{#each leechSimilar as x (x.char)}
					<div><span class="jp" data-lookup={x.char}>{x.char}</span> {x.meaning}{x.tip ? ` — ${x.tip}` : ''}</div>
				{/each}
			</div>
		{/if}
		{#if warn}<div class="warning small">{warn}</div>{/if}

		{#if result}
			<div class="card reveal stack">
				<div class="row">
					<strong>{result.correct ? '✓ Correcto' : '✗ Incorrecto'}</strong>
					<span class="jp">
						{#if current.facet === 'reading' && current.itemType !== 'kana'}
							{#each result.answers as a, i (a)}{#if i}、{/if}<KanaHint text={a} />{/each}
						{:else}{result.answers.join('、')}{/if}
					</span>
					{#if current.itemType === 'kana'}
						<SpeakButton text={current.facet === 'reading' ? current.prompt : current.itemKey} />
					{:else if current.itemType !== 'component'}
						<SpeakButton text={current.extra?.reading?.split('、')[0] ?? current.prompt} />
					{/if}
				</div>
				{#if result.confusedWith}
					<div class="small warning">Eso corresponde a <span class="jp" data-lookup={result.confusedWith}>{result.confusedWith}</span>. Registrado como confusión.</div>
				{/if}
				{#if current.extra?.meaning || current.extra?.reading}
					<div class="small muted">
						{#if current.extra.meaning}<div>Significado: {current.extra.meaning}</div>{/if}
						{#if current.extra.reading && current.itemType !== 'kana'}
							<div class="jp">Lectura: {#each current.extra.reading.split('、') as r, i (r)}{#if i}、{/if}<KanaHint text={r} />{/each}</div>
						{/if}
					</div>
				{/if}
				{#if current.extra?.explanation}
					<div class="small"><Markdown text={current.extra.explanation} /></div>
				{/if}
				{#if current.extra?.example}
					<div class="small example">
						<span class="muted">En contexto:</span>
						<span class="jp"><PromptText text={current.extra.example.jp} highlight={current.prompt} /></span>
						<SpeakButton text={current.extra.example.jp} />
						{#if current.extra.example.es}<div class="muted">{current.extra.example.es}</div>{/if}
					</div>
				{/if}
				{#if current.extra?.mnemonic && !result.correct}
					<div class="small"><Markdown text={current.extra.mnemonic} /></div>
				{/if}
				{#if current.extra?.similar?.length && !result.correct}
					<div class="small warning">
						¡Ojo con los parecidos!
						{#each current.extra.similar as x (x.char)}
							<div><span class="jp" data-lookup={x.char}>{x.char}</span>{x.tip ? ` — ${x.tip}` : ''}</div>
						{/each}
					</div>
				{/if}
				{#if why}<div class="small tutor"><Markdown text={why} /></div>{/if}

				<!-- Acciones de consulta (las de seguir van abajo, en el sitio de las opciones). -->
				{#if aiUi()}
					<div class="row secondary">
						{#if !result.correct && aiUi() && current.itemType !== 'kana' && current.answerMode !== 'trace'}
							<button class="small" onclick={explain} disabled={whyLoading}>
								{#if whyLoading}<span class="spinner"></span>{/if} ¿Por qué?
							</button>
						{/if}
						{#if aiUi()}
							<button class="ghost small" onclick={() => askTutor(tutor.context)} title="Abre el tutor con esta tarjeta como contexto">
								Preguntar al tutor
							</button>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
		</div>

	<!-- Barra: lo de antes de responder. Después, los botones van en el sitio de las opciones (answer-zone). -->
	{#if !result}
		<div class="bar">
			<div class="row tight">
				{#if canToggleChoices}
					<button class="small ghost" onclick={toggleChoices} disabled={busy} title="Cambiar entre elegir y escribir (queda guardado)">
						{useChoices ? '⌨ Escribir' : '☰ Opciones'}
					</button>
				{/if}
				{#if voiceOk && canVoice(current) && (!voiceMode || voicePaused || voiceFallback) && !listening}
					<button class="small mic" onclick={micOnce} disabled={busy} title="Responder en voz alta (reconocimiento del navegador)" aria-label="Responder en voz alta">🎙</button>
				{:else if showVoice && listening}
					<button class="small mic on" onclick={() => (voicePaused = true)} title="Dejar de escuchar">⏸</button>
				{/if}
			</div>
			<div class="row tight">
				{#if current.answerMode !== 'trace'}
					<button onclick={giveUp} disabled={busy}>No sé</button>
				{/if}
				{#if !showChoices && !showVoice && current.answerMode !== 'trace'}
					<button class="primary" onclick={check} disabled={busy || !answer.trim()}>Comprobar <kbd>↵</kbd></button>
				{/if}
			</div>
		</div>
	{/if}
	</div>
{/if}

<style>
	.session {
		max-width: 620px;
		margin: 0 auto;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		/* Todo el alto disponible: la barra queda abajo aunque la tarjeta sea corta. */
		min-height: calc(100dvh - var(--top, 0px) - var(--bottom-h, 0px) - 0.5rem);
	}
	.session.fit {
		height: calc(100dvh - var(--top, 0px) - var(--bottom-h, 0px) - 0.5rem);
		/* Pantallas muy bajas: antes que aplastar las opciones, que la página haga scroll. */
		min-height: 24rem;
	}
	/* La sesión ya descuenta la navegación: el relleno inferior de main solo crearía un scroll de más. */
	:global(main:has(.session.fit)) {
		padding-bottom: 0 !important;
	}
	/* Orden visual (el DOM deja la respuesta antes de la explicación): enunciado · explicación · respuesta · barra. */
	.middle {
		order: 1;
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}
	.fit .middle {
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.middle.idle {
		flex: 0 0 auto;
	}
	.answer-zone {
		order: 2;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	/* Antes de responder, el enunciado ocupa el espacio libre; después se achica y deja sitio a la explicación. */
	.fit .prompt:not(.compact) {
		flex: 1 1 auto;
	}
	.prompt.compact {
		min-height: 0;
		padding: 0.4rem 0.8rem;
		flex-shrink: 0;
	}
	.prompt.compact .big {
		font-size: clamp(2rem, 8vw, 3rem);
	}
	.prompt.compact .sentence {
		font-size: 1.15rem;
		line-height: 1.9;
	}
	.progress {
		height: 4px;
		background: var(--bg-3);
		border-radius: 2px;
		overflow: hidden;
	}
	.progress div {
		height: 100%;
		background: var(--accent);
		transition: width 0.3s;
	}
	.prompt {
		border-radius: var(--radius);
		min-height: 180px;
		display: grid;
		place-items: center;
		padding: 1rem;
		color: #fff;
	}
	.type-grammar {
		background: var(--accent-2);
	}
	.type-sentence {
		background: color-mix(in srgb, var(--vocab) 75%, #000);
	}
	.sentence {
		font-size: clamp(1.4rem, 5vw, 2rem);
		line-height: 2.2;
		text-align: center;
	}
	.fontname {
		font-weight: 400;
		opacity: 0.6;
		font-size: 0.8rem;
	}
	.choices {
		display: grid;
		gap: 0.4rem;
	}
	.choice {
		justify-content: flex-start;
		text-align: left;
		gap: 0.6rem;
	}
	.choice .num {
		min-width: 1em;
	}
	.choice.kana-opt {
		justify-content: center;
		font-size: 2rem;
		padding: 0.5rem 1rem;
	}
	.romaji {
		font-family: var(--font-ui, system-ui, sans-serif);
		letter-spacing: 0.04em;
	}
	.leech {
		border-color: var(--warn);
	}
	.example {
		border-left: 3px solid var(--vocab);
		padding-left: 0.6rem;
	}
	.type-kanji {
		background: var(--kanji);
	}
	.type-component {
		background: var(--component);
	}
	.type-vocab {
		background: var(--vocab);
	}
	.type-kana {
		background: var(--kana);
	}
	.big {
		font-size: clamp(3rem, 12vw, 5.5rem);
		line-height: 1.1;
		text-align: center;
		word-break: keep-all;
	}
	.label {
		text-align: center;
		padding: 0.35rem;
		border-radius: var(--radius-sm);
		font-weight: 600;
	}
	.label.facet-meaning {
		background: #e8e6e3;
		color: #14161b;
		/* borde para que la franja clara se distinga también sobre el fondo del tema claro */
		border: 1px solid var(--line);
	}
	.facet-writing.prompt {
		background: color-mix(in srgb, var(--kanji) 70%, #000);
	}
	.label.facet-writing {
		background: var(--bg-3);
		color: var(--text);
		border: 1px dashed var(--line);
	}
	.center {
		text-align: center;
	}
	.answer-row {
		display: flex;
		gap: 0.4rem;
		align-items: stretch;
	}
	.answer-row > :global(:first-child) {
		flex: 1;
		min-width: 0;
	}
	.voice-box {
		text-align: center;
		padding: 0.8rem;
		font-size: 1.2rem;
		border: 1px dashed var(--line);
		border-radius: var(--radius-sm);
		color: var(--text-2);
	}
	.voice-box.on {
		border-color: var(--bad);
		border-style: solid;
		animation: blink 1.4s infinite;
	}
	/* Tras responder: lo respondido (y lo correcto si fallaste) y los botones grandes, del ancho de una opción. */
	.verdict {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: baseline;
		gap: 0.4rem;
		padding: 0.55rem 0.8rem;
		font-size: 1.15rem;
		border-radius: var(--radius-sm);
	}
	.verdict.ok {
		border: 1px solid var(--ok);
		background: color-mix(in srgb, var(--ok) 12%, var(--bg));
	}
	.verdict.bad {
		border: 1px solid var(--bad);
		background: color-mix(in srgb, var(--bad) 12%, var(--bg));
	}
	.act {
		width: 100%;
		justify-content: center;
		padding: 0.75rem 1rem;
		font-size: 1.05rem;
	}
	.voice-toggle.on {
		border-color: var(--accent);
		color: var(--accent);
	}
	.mic {
		font-size: 1.1rem;
	}
	.mic.on {
		border-color: var(--bad);
		animation: blink 1s infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0.5;
		}
	}
	.label.facet-reading {
		background: #0b0c0f;
		color: #e8e6e3;
		border: 1px solid var(--line);
	}
	.reveal {
		border-color: var(--line);
	}
	.secondary {
		border-top: 1px solid var(--line);
		padding-top: 0.6rem;
	}
	.bar {
		order: 3;
		flex-shrink: 0;
		/* En la escritura (sin alto fijo) la barra se pega abajo al hacer scroll. */
		position: sticky;
		bottom: var(--bottom-h, 0px);
		z-index: 39;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		min-height: 3.4rem;
		padding: 0.55rem 0;
		background: var(--bg);
		border-top: 1px solid var(--line);
		box-shadow: 0 -8px 16px -12px var(--shadow);
	}
	.bar :global(button) {
		white-space: nowrap;
	}
	.tight {
		gap: 0.4rem;
		flex-wrap: nowrap;
	}
	kbd {
		font-size: 0.7rem;
		opacity: 0.6;
	}
	@media (max-width: 760px) {
		/* En el móvil no hay teclado físico: los atajos solo ocupan sitio. */
		kbd {
			display: none;
		}
	}
	.tutor {
		border-left: 3px solid var(--info);
		padding-left: 0.7rem;
	}
	.done {
		text-align: center;
		max-width: 620px;
		margin: 0 auto;
	}
</style>
