<script lang="ts">
	import type { GradeResult, ReviewItem } from '../types.ts';
	import { post, errMsg } from '../client/api.ts';
	import AnswerInput from './AnswerInput.svelte';
	import SpeakButton from './SpeakButton.svelte';
	import Markdown from './Markdown.svelte';
	import PromptText from './PromptText.svelte';
	import { FONT_LABELS, pickFont } from '../client/state.svelte.ts';
	import { askTutor, setScreenContext, tutor } from '../client/tutorContext.svelte.ts';
	import { aiUi } from '../client/ai.svelte.ts';
	import type { PromptFont } from '../types.ts';
	import { onMount } from 'svelte';
	import { keepAwake } from '../client/wakeLock.ts';
	import KanjiTrace from './KanjiTrace.svelte';
	import { toast } from '../client/toast.svelte.ts';
	import { writingGrade } from '../strokes.ts';
	import { recognizeJapanese, speechRecognitionSupported } from '../client/voice.ts';
	import { isKana, toHiragana } from 'wanakana';

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
	let warn = $state('');
	let busy = $state(false);
	let started = Date.now();
	let correctCount = $state(0);
	let wrongCount = $state(0);
	let done = $state(0);
	let why = $state('');
	let whyLoading = $state(false);
	let shake = $state(false);

	const current = $derived(queue[0]);
	const finished = $derived(queue.length === 0);
	/** Kana, componentes y gramática siempre en gótica; el resto, fuente variada para reconocer kanji «en la calle». */
	let font: PromptFont = $state('gothic');
	const rollFont = (it: ReviewItem | undefined) =>
		(font = it && ['kanji', 'vocab', 'sentence'].includes(it.itemType) ? pickFont() : 'gothic');
	$effect.pre(() => {
		if (queue.length && font === 'gothic') rollFont(queue[0]);
	});

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

	// Lecturas en voz alta (reconocimiento del navegador, ja-JP): kana → se corrige como lo escrito; si el navegador
	// devuelve la palabra en kanji, el servidor la acepta si es exactamente esa palabra.
	const voiceOk = speechRecognitionSupported();
	let listening = $state(false);
	async function sayIt() {
		if (listening || result) return;
		listening = true;
		warn = '';
		try {
			const alts = await recognizeJapanese().result;
			if (!alts.length) {
				warn = 'No te oí: prueba otra vez o escríbelo.';
				return;
			}
			const kana = alts.map((a) => toHiragana(a.replace(/[。、！？!?\s]/g, ''))).find((a) => isKana(a));
			answer = kana ?? alts[0];
			await check();
		} catch (e) {
			warn = `Sin reconocimiento de voz: ${errMsg(e)}`;
		} finally {
			listening = false;
		}
	}

	function choose(opt: string) {
		if (result || busy) return;
		answer = opt;
		check();
	}

	$effect(() => {
		if (finished && total > 0) onfinish?.({ correct: correctCount, wrong: wrongCount });
	});

	async function check() {
		if (!current || busy) return;
		if (result) return next(result.correct ? 3 : undefined);
		if (!answer.trim()) return;
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

	async function next(grade?: number, override = false) {
		if (!current || !result || busy) return;
		busy = true;
		try {
			const res = await post<{ leech?: boolean; cardId: number }>('/api/answer', {
				itemType: current.itemType,
				itemKey: current.itemKey,
				facet: current.facet,
				answer,
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
			answer = '';
			result = null;
			why = '';
			warn = '';
			started = Date.now();
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
		if (!result || busy) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			if (current?.answerMode === 'trace') next(result.correct ? writingGrade(Number(answer)).grade : undefined);
			else next(result.correct ? 3 : undefined);
		} else if (result.correct && ['1', '2', '3'].includes(e.key)) {
			e.preventDefault();
			next({ '1': 2, '2': 3, '3': 4 }[e.key]);
		}
	}
</script>

<svelte:window {onkeydown} />

{#if finished}
	<div class="card done">
		<h2>¡Terminado! 🎉</h2>
		<p>{correctCount} aciertos · {wrongCount} fallos</p>
	</div>
{:else if current}
	<div class="session">
		<div class="progress"><div style="width:{(done / Math.max(1, total)) * 100}%"></div></div>
		<div class="spread small muted">
			<span>{done} / {total}</span>
			<span>✓ {correctCount} · ✗ {wrongCount}</span>
		</div>

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

		<div class="prompt type-{current.itemType} facet-{current.facet}">
			{#if current.answerMode === 'trace'}
				<span class="sentence">✍ {current.prompt}</span>
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
		{:else if current.answerMode === 'choice' && current.options}
			<div class="choices">
				{#each current.options as opt (opt)}
					<button
						class="choice"
						class:right={result && result.answers.includes(opt)}
						class:wrong={result && !result.correct && answer === opt}
						disabled={!!result || busy}
						onclick={() => choose(opt)}>{opt}</button
					>
				{/each}
			</div>
		{:else}
			<div class:shake class="answer-row">
				<AnswerInput
					bind:value={answer}
					mode={current.answerMode}
					disabled={!!result || busy}
					status={result ? (result.correct ? 'ok' : 'bad') : warn ? 'warn' : 'idle'}
					onsubmit={check}
				/>
				{#if current.answerMode === 'kana' && voiceOk && !result}
					<button
						class="mic"
						class:on={listening}
						onclick={sayIt}
						disabled={busy}
						title="Decir la lectura en voz alta (reconocimiento del navegador)"
						aria-label="Responder en voz alta">🎙</button
					>
				{/if}
			</div>
			{#if listening}<div class="small muted center">🎙 Di la lectura…</div>{/if}
		{/if}
		{#if warn}<div class="warning small">{warn}</div>{/if}

		{#if result}
			<div class="card reveal stack">
				<div class="row">
					<strong>{result.correct ? '✓ Correcto' : '✗ Incorrecto'}</strong>
					<span class="jp">{result.answers.join('、')}</span>
					{#if current.itemType !== 'component' && current.itemType !== 'kana'}
						<SpeakButton text={current.extra?.reading?.split('、')[0] ?? current.prompt} />
					{/if}
				</div>
				{#if result.confusedWith}
					<div class="small warning">Eso corresponde a <span class="jp" data-lookup={result.confusedWith}>{result.confusedWith}</span>. Registrado como confusión.</div>
				{/if}
				{#if current.extra?.meaning || current.extra?.reading}
					<div class="small muted">
						{#if current.extra.meaning}<div>Significado: {current.extra.meaning}</div>{/if}
						{#if current.extra.reading}<div class="jp">Lectura: {current.extra.reading}</div>{/if}
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

				<div class="row actions">
					{#if result.correct && current.answerMode === 'trace'}
						<!-- La nota sale de los fallos de trazo: 0 = Bien, 1-2 = Difícil. -->
						<span class="small muted">{Number(answer) ? `${answer} trazo(s) fallado(s)` : 'Sin fallos'}</span>
						<button class="primary" onclick={() => next(writingGrade(Number(answer)).grade)} disabled={busy}>Continuar <kbd>↵</kbd></button>
					{:else if result.correct}
						<button onclick={() => next(2)} disabled={busy}>Difícil <kbd>1</kbd></button>
						<button class="primary" onclick={() => next(3)} disabled={busy}>Bien <kbd>2/↵</kbd></button>
						<button onclick={() => next(4)} disabled={busy}>Fácil <kbd>3</kbd></button>
					{:else}
						<button class="primary" onclick={() => next()} disabled={busy}>Continuar <kbd>↵</kbd></button>
						<button onclick={() => next(3, true)} disabled={busy} title="Errata o sinónimo válido">Contar como correcta</button>
						{#if aiUi() && current.itemType !== 'kana' && current.answerMode !== 'trace'}
							<button onclick={explain} disabled={whyLoading}>
								{#if whyLoading}<span class="spinner"></span>{/if} ¿Por qué?
							</button>
						{/if}
					{/if}
					{#if aiUi()}
						<button class="ghost small" onclick={() => askTutor(tutor.context)} title="Abre el tutor con esta tarjeta como contexto">
							Preguntar al tutor
						</button>
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
	}
	.choice.right {
		border-color: var(--ok);
		background: color-mix(in srgb, var(--ok) 15%, var(--bg-3));
	}
	.choice.wrong {
		border-color: var(--bad);
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
	.mic {
		font-size: 1.2rem;
		padding: 0 0.8rem;
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
	.actions {
		justify-content: flex-end;
	}
	kbd {
		font-size: 0.7rem;
		opacity: 0.6;
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
