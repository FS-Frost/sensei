<script lang="ts">
	// Conversación con el tutor (página completa o panel lateral).
	// Sin sesión: borrador; el primer mensaje crea la sesión (/api/chat/start) y avisa con `onsession`.
	import { onDestroy, tick, untrack } from 'svelte';
	import { startRecording, MAX_SECONDS, type Recorder } from '../../client/voice.ts';
	import { speakMixed, stopSpeaking, ttsSupported } from '../../client/tts.ts';
	import { bind, unbind } from 'wanakana';
	import { get, postStream, errMsg } from '../../client/api.ts';
	import type { ChatMode, Quiz, QuizAnswer, ScreenContext, UiBlock } from '../../types.ts';
	import Markdown from '../Markdown.svelte';
	import QuizView from '../QuizView.svelte';
	import JpTokens from '../JpTokens.svelte';
	import MineSentence from '../MineSentence.svelte';
	import SpeakButton from '../SpeakButton.svelte';
	import ActionBlock from './ActionBlock.svelte';
	import InfoCardView from './InfoCardView.svelte';

	type Msg = { id: number | string; role: 'user' | 'model'; ui: UiBlock[] };
	type Ev =
		| { type: 'text'; delta: string }
		| { type: 'tool'; name: string; label: string }
		| { type: 'quiz'; quiz: Quiz }
		| { type: 'graded'; quizId: string; answers: QuizAnswer[] }
		| { type: 'block'; block: UiBlock }
		| { type: 'session'; id: number }
		| { type: 'heard'; transcript: string }
		| { type: 'error'; message: string }
		| { type: 'done' };

	let {
		sessionId = null,
		mode,
		origin = 'page',
		compact = false,
		context = null,
		draft = $bindable(''),
		suggestions = [],
		onsession,
		onclearcontext,
		onsent
	}: {
		sessionId?: number | null;
		mode: ChatMode;
		origin?: 'page' | 'panel' | 'daily';
		compact?: boolean;
		/** Contexto de pantalla a adjuntar al próximo mensaje (chip visible). */
		context?: ScreenContext | null;
		draft?: string;
		suggestions?: string[];
		onsession?: (id: number) => void;
		onclearcontext?: () => void;
		onsent?: () => void;
	} = $props();

	let sid: number | null = $state(untrack(() => sessionId));
	let messages: Msg[] = $state([]);
	let undoable: Record<number, boolean> = $state({});
	let busy = $state(false);
	let error = $state('');
	let kanaInput = $state(false);
	let list: HTMLDivElement | undefined = $state();
	let ta: HTMLTextAreaElement | undefined = $state();

	// Cambiar de sesión desde fuera (p. ej. «Nueva» en el panel) recarga.
	$effect(() => {
		const next = sessionId;
		untrack(() => {
			if (next === sid && messages.length) return;
			sid = next;
			messages = [];
			if (next) load().catch((e) => (error = errMsg(e)));
		});
	});

	/** Las respuestas rápidas solo valen si el alumno no ha escrito nada después (una respuesta ocupa varias filas). */
	const lastUserIdx = $derived.by(() => {
		for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') return i;
		return -1;
	});
	const pendingQuiz = $derived.by(() => {
		const last = messages[messages.length - 1];
		if (!last || last.role !== 'model') return null;
		const b = last.ui.find((x) => x.type === 'quiz' && !x.answers);
		return b && b.type === 'quiz' ? b.quiz : null;
	});

	/** El último turno quedó sin respuesta (p. ej. Gemini devolvió 503): se ofrece «Reintentar». */
	let incomplete = $state(false);

	async function load() {
		if (!sid) return;
		const r = await get<{ messages: Msg[]; undoable: Record<number, boolean>; incomplete: boolean }>(`/api/chat/${sid}`);
		messages = r.messages;
		undoable = r.undoable;
		incomplete = r.incomplete;
		await scroll();
	}

	async function scroll() {
		await tick();
		list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
	}

	export async function send(payload: {
		text?: string;
		audio?: { mimeType: string; data: string; seconds: number };
		quizAnswers?: { quizId: string; answers: { id: string; answer: string }[] };
		retry?: boolean;
	}) {
		if (busy) return;
		if (!sid && !payload.text && !payload.audio) return;
		busy = true;
		error = '';
		incomplete = false;
		stopSpeaking();
		const ctx = payload.retry ? null : context;
		if (payload.text || payload.audio)
			messages = [
				...messages,
				{
					id: `u${Date.now()}`,
					role: 'user',
					ui: [
						...(ctx ? [{ type: 'context', label: ctx.label } as UiBlock] : []),
						...(payload.audio ? [{ type: 'audio', seconds: payload.audio.seconds } as UiBlock] : []),
						...(payload.text ? [{ type: 'text', text: payload.text } as UiBlock] : [])
					]
				}
			];
		const draftMsg: Msg = $state({ id: `m${Date.now()}`, role: 'model', ui: [] });
		let added = false;
		const ensure = () => {
			if (!added) {
				messages = [...messages, draftMsg];
				added = true;
			}
		};
		await scroll();
		let createdId: number | null = null;
		try {
			const url = sid ? `/api/chat/${sid}` : '/api/chat/start';
			const body = sid ? { ...payload, context: ctx } : { mode, origin, text: payload.text, audio: payload.audio, context: ctx };
			for await (const ev of postStream<Ev>(url, body)) {
				if (ev.type === 'session') {
					createdId = ev.id;
					sid = ev.id;
				} else if (ev.type === 'heard') {
					// Lo que el tutor entendió va a la burbuja de voz del alumno.
					for (let i = messages.length - 1; i >= 0; i--) {
						const b = messages[i].ui.find((x) => x.type === 'audio' && !x.transcript);
						if (messages[i].role === 'user' && b && b.type === 'audio') {
							b.transcript = ev.transcript;
							break;
						}
					}
				} else if (ev.type === 'text') {
					ensure();
					const last = draftMsg.ui[draftMsg.ui.length - 1];
					if (last?.type === 'text') last.text += ev.delta;
					else draftMsg.ui.push({ type: 'text', text: ev.delta });
				} else if (ev.type === 'tool') {
					ensure();
					draftMsg.ui.push({ type: 'tool', name: ev.name, label: ev.label });
				} else if (ev.type === 'quiz') {
					ensure();
					draftMsg.ui.push({ type: 'quiz', quiz: ev.quiz });
				} else if (ev.type === 'block') {
					ensure();
					draftMsg.ui.push(ev.block);
				} else if (ev.type === 'graded') {
					for (const m of messages) for (const b of m.ui) if (b.type === 'quiz' && b.quiz.id === ev.quizId) b.answers = ev.answers;
				} else if (ev.type === 'error') error = ev.message;
				await scroll();
			}
			if (ctx) onclearcontext?.();
			onsent?.();
		} catch (e) {
			error = errMsg(e);
		} finally {
			busy = false;
		}
		// Voz: leer la respuesta y, en manos libres, volver a escuchar al terminar.
		const reply = draftMsg.ui
			.filter((b) => b.type === 'text')
			.map((b) => shown((b as { text: string }).text))
			.join('\n');
		await load().catch(() => {});
		if (createdId) onsession?.(createdId);
		if (!error && reply && (readAloud || handsFree)) {
			speakingId = 'last';
			await speakMixed(reply);
			speakingId = null;
		}
		if (!error && handsFree && !pendingQuiz) void startRec();
	}

	// ---------- Voz ----------
	const prefKey = (k: string) => `sensei.voice.${k}`;
	const loadPref = (k: string) => {
		try {
			return localStorage.getItem(prefKey(k)) === '1';
		} catch {
			return false;
		}
	};
	const savePref = (k: string, v: boolean) => {
		try {
			localStorage.setItem(prefKey(k), v ? '1' : '0');
		} catch {
			/* sin almacenamiento */
		}
	};
	let readAloud = $state(loadPref('readAloud'));
	let handsFree = $state(false); // no se recuerda: activarlo es una decisión de cada conversación
	let rec: Recorder | null = null;
	let recording = $state(false);
	let recStart = 0;
	let recSecs = $state(0);
	let levels: number[] = $state(Array(28).fill(0));
	let recTimer: ReturnType<typeof setInterval> | undefined;
	let micError = $state('');
	let speakingId: string | number | null = $state(null);
	/** Audios grabados en esta visita (para volver a oírlos): id de mensaje → URL. */
	const audioUrls = new Map<string | number, string>();
	const canRecord = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

	async function startRec() {
		if (recording || busy) return;
		micError = '';
		stopSpeaking();
		try {
			rec = await startRecording({
				autoStop: handsFree,
				onAutoStop: () => void finishRec(),
				onLevel: (v) => (levels = [...levels.slice(1), v])
			});
			recording = true;
			recStart = Date.now();
			recSecs = 0;
			recTimer = setInterval(() => (recSecs = Math.floor((Date.now() - recStart) / 1000)), 250);
		} catch (e) {
			micError = `Sin micrófono: ${errMsg(e)}`;
			handsFree = false;
		}
	}

	async function finishRec() {
		if (!rec || !recording) return;
		const r = rec;
		rec = null;
		recording = false;
		clearInterval(recTimer);
		const got = await r.stop();
		levels = Array(28).fill(0);
		if (!got) {
			micError = 'No te oí. Habla un poco más cerca del micrófono.';
			if (handsFree) void startRec();
			return;
		}
		pendingAudioUrl = got.url;
		await send({ audio: { mimeType: 'audio/wav', data: got.base64, seconds: got.seconds } });
	}

	function cancelRec() {
		rec?.cancel();
		rec = null;
		recording = false;
		clearInterval(recTimer);
		levels = Array(28).fill(0);
		handsFree = false;
	}

	function toggleHandsFree() {
		handsFree = !handsFree;
		if (handsFree) void startRec();
		else if (recording) cancelRec();
	}

	function toggleReadAloud() {
		readAloud = !readAloud;
		savePref('readAloud', readAloud);
		if (!readAloud) stopSpeaking();
	}

	async function speakMsg(m: Msg) {
		if (speakingId === m.id) {
			stopSpeaking();
			speakingId = null;
			return;
		}
		speakingId = m.id;
		await speakMixed(m.ui.filter((b) => b.type === 'text').map((b) => shown((b as { text: string }).text)).join('\n'));
		if (speakingId === m.id) speakingId = null;
	}

	/** La URL del último audio enviado se asocia al mensaje que crea `load()` (los ids del servidor son otros). */
	let pendingAudioUrl: string | null = $state(null);
	$effect(() => {
		if (!pendingAudioUrl) return;
		const last = [...messages].reverse().find((m) => m.role === 'user' && m.ui.some((b) => b.type === 'audio'));
		if (!last) return;
		audioUrls.set(last.id, pendingAudioUrl);
		// El mensaje provisional (id de texto) se sustituye al recargar por el del servidor (id numérico).
		if (typeof last.id === 'number') pendingAudioUrl = null;
	});
	function playAudio(id: string | number) {
		const url = audioUrls.get(id);
		if (url) void new Audio(url).play();
	}

	/** Texto del tutor sin la línea «[Oído: …]» (también mientras llega en streaming). */
	function shown(text: string) {
		if (/^\s*\[Oído:/.test(text)) {
			const end = text.indexOf(']');
			return end < 0 ? '' : text.slice(end + 1).replace(/^\s*\n?/, '');
		}
		return text;
	}

	const fmtSecs = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
	onDestroy(() => {
		rec?.cancel();
		clearInterval(recTimer);
		stopSpeaking();
		for (const u of audioUrls.values()) URL.revokeObjectURL(u);
	});

	function submitText() {
		if (ta) draft = ta.value;
		const text = draft.trim();
		if (!text) return;
		draft = '';
		send({ text });
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			submitText();
		}
	}

	$effect(() => {
		if (!ta || !kanaInput) return;
		const node = ta;
		bind(node, { IMEMode: 'toHiragana' });
		return () => unbind(node);
	});

	const plain = (tokens: { s: string }[]) => tokens.map((t) => t.s).join('');
</script>

<div class="chat" class:compact>
	<div class="messages" bind:this={list}>
		{#if !messages.length}
			<div class="empty muted small">
				{#if context}Pregunta lo que quieras sobre lo que estás viendo.{:else}Escribe tu mensaje o elige una sugerencia.{/if}
			</div>
		{/if}
		{#each messages as m, mi (m.id)}
			<div class="msg {m.role}">
				{#each m.ui as b, i (i)}
					{#if b.type === 'text'}
						{#if m.role === 'user'}<div class="bubble jp">{b.text}</div>
						{:else if shown(b.text)}<div class="bubble"><Markdown text={shown(b.text)} /></div>{/if}
					{:else if b.type === 'audio'}
						<div class="bubble voice">
							<div class="voice-head">
								{#if audioUrls.has(m.id)}
									<button class="ghost small play" onclick={() => playAudio(m.id)} aria-label="Volver a oír tu audio">▶</button>
								{:else}<span aria-hidden="true">🎙</span>{/if}
								<span class="small">Mensaje de voz · {fmtSecs(b.seconds)}</span>
							</div>
							{#if b.transcript}<div class="heard jp"><span class="small dim">Te oí:</span> «{b.transcript}»</div>
							{:else if busy && mi === messages.length - 1}<div class="small dim">Escuchando…</div>{/if}
						</div>
					{:else if b.type === 'context'}
						<div class="ctx small">📎 {b.label}</div>
					{:else if b.type === 'tool'}
						<div class="tool small dim">⚙ {b.label}…</div>
					{:else if b.type === 'quiz'}
						<QuizView
							quiz={b.quiz}
							answers={b.answers}
							disabled={busy}
							onsubmit={(answers) => send({ quizAnswers: { quizId: b.quiz.id, answers } })}
						/>
					{:else if b.type === 'action'}
						<ActionBlock actionId={b.actionId} label={b.label} kind={b.kind} status={b.status} undoable={undoable[b.actionId] ?? true} />
					{:else if b.type === 'card'}
						<InfoCardView card={b.card} />
					{:else if b.type === 'choices'}
						<div class="choices">
							{#each b.options as o (o)}
								<button class="small" disabled={busy || mi < lastUserIdx} onclick={() => send({ text: o })}>{o}</button>
							{/each}
						</div>
					{:else if b.type === 'links'}
						<div class="choices">
							{#each b.links as l (l.href)}<a class="btn small" href={l.href}>{l.label} →</a>{/each}
						</div>
					{:else if b.type === 'jptext'}
						<div class="bubble jptext">
							<div class="jpline"><JpTokens tokens={b.tokens} serif /> <SpeakButton text={plain(b.tokens)} /></div>
							{#if b.es}<div class="small muted">{b.es}</div>{/if}
							<MineSentence tokens={b.tokens} es={b.es ?? null} source="tutor" />
						</div>
					{/if}
				{/each}
				{#if m.role === 'model' && ttsSupported() && m.ui.some((b) => b.type === 'text' && shown(b.text))}
					<button class="ghost small speak" onclick={() => speakMsg(m)} title={speakingId === m.id ? 'Parar' : 'Leer en voz alta'}>
						{speakingId === m.id ? '⏹' : '🔊'}
					</button>
				{/if}
			</div>
		{/each}
		{#if busy}<div class="msg model"><span class="spinner"></span></div>{/if}
	</div>

	{#if error || (incomplete && !busy)}
		<div class="error small row">
			<span>{error || 'El último mensaje se quedó sin respuesta.'}</span>
			{#if sid}<button class="small" onclick={() => send({ retry: true })} disabled={busy}>Reintentar</button>{/if}
		</div>
	{/if}

	{#if !busy && suggestions.length && messages.length === 0}
		<div class="row suggest">
			{#each suggestions as sgt (sgt)}
				<button class="small" onclick={() => send({ text: sgt })}>{sgt}</button>
			{/each}
		</div>
	{/if}

	{#if context}
		<div class="chip small">
			📎 Contexto: {context.label}
			<button class="ghost small x" onclick={() => onclearcontext?.()} title="No adjuntar" aria-label="Quitar contexto">✕</button>
		</div>
	{/if}

	{#if micError}<div class="small warn-text">{micError}</div>{/if}
	{#if handsFree || readAloud}
		<div class="voice-mode small">
			{#if handsFree}🗣 <strong>Manos libres</strong>: habla, haz una pausa y se envía solo; el tutor te responde en voz alta.
			{:else}🔊 Las respuestas se leen en voz alta.{/if}
			{#if speakingId}<button class="ghost small" onclick={() => { stopSpeaking(); speakingId = null; }}>Callar</button>{/if}
		</div>
	{/if}

	{#if recording}
		<div class="composer rec" role="group" aria-label="Grabando mensaje de voz">
			<span class="dot" aria-hidden="true"></span>
			<div class="wave" aria-hidden="true">
				{#each levels as l, i (i)}<span style="height:{Math.max(8, l * 100)}%"></span>{/each}
			</div>
			<span class="small timer">{fmtSecs(recSecs)} / {fmtSecs(MAX_SECONDS)}</span>
			<button class="ghost" onclick={cancelRec} title="Cancelar (no se envía)">✕</button>
			<button class="primary" onclick={finishRec} title="Enviar el audio">Enviar ➤</button>
		</div>
	{:else}
	<div class="composer">
		<textarea
			bind:this={ta}
			bind:value={draft}
			{onkeydown}
			rows={compact ? 2 : 2}
			lang={kanaInput ? 'ja' : 'es'}
			class:jp={kanaInput}
			placeholder={pendingQuiz ? 'Responde el quiz o escribe para saltarlo…' : 'Escribe… (Enter envía, Shift+Enter nueva línea)'}
		></textarea>
		<div class="tools">
			<div class="row-tools">
				<button class="small" class:on={kanaInput} onclick={() => (kanaInput = !kanaInput)} title="Convierte el romaji a hiragana mientras escribes"
					>あ</button
				>
				{#if canRecord}
					<button class="small mic" onclick={() => void startRec()} disabled={busy} title="Hablar (mensaje de voz: español, japonés o los dos)" aria-label="Grabar mensaje de voz">🎙</button>
				{/if}
			</div>
			{#if draft.trim() || !canRecord}
				<button class="primary" onclick={submitText} disabled={busy}>Enviar</button>
			{:else}
				<div class="row-tools">
					<button class="small" class:on={handsFree} onclick={toggleHandsFree} title="Conversación por voz: escucha, responde y vuelve a escuchar">🗣</button>
					{#if ttsSupported()}
						<button class="small" class:on={readAloud} onclick={toggleReadAloud} title="Leer las respuestas en voz alta">🔊</button>
					{/if}
				</div>
			{/if}
		</div>
	</div>
	{/if}
</div>

<style>
	.chat {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		min-height: 0;
		flex: 1;
	}
	.messages {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		padding: 0.3rem 0.2rem;
	}
	.msg {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		max-width: 94%;
	}
	.msg.user {
		align-self: flex-end;
		align-items: flex-end;
	}
	.bubble {
		background: var(--bg-2);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 0.65rem 0.9rem;
		font-size: 1.02rem;
		line-height: 1.9;
	}
	.compact .bubble {
		font-size: 0.97rem;
		padding: 0.55rem 0.75rem;
	}
	.user .bubble {
		background: color-mix(in srgb, var(--accent) 20%, var(--bg-2));
		border-color: color-mix(in srgb, var(--accent) 40%, transparent);
		white-space: pre-wrap;
	}
	.jptext {
		font-size: 1.2rem;
	}
	.jpline {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
	}
	.ctx {
		color: var(--text-2);
	}
	.tool {
		padding-left: 0.3rem;
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.empty {
		margin: auto;
		text-align: center;
	}
	.suggest {
		gap: 0.35rem;
	}
	.chip {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		align-self: flex-start;
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 0.1rem 0.2rem 0.1rem 0.7rem;
		color: var(--text-2);
	}
	.chip .x {
		border: none;
		padding: 0.1rem 0.4rem;
	}
	.composer {
		display: flex;
		gap: 0.5rem;
		align-items: flex-end;
	}
	.composer textarea {
		resize: none;
		font-size: 1rem;
	}
	.tools {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.tools .on {
		border-color: var(--info);
		background: color-mix(in srgb, var(--info) 20%, var(--bg-3));
	}
	.row-tools {
		display: flex;
		gap: 0.3rem;
	}
	.speak {
		align-self: flex-start;
		padding: 0.05rem 0.4rem;
		opacity: 0.7;
	}
	.speak:hover {
		opacity: 1;
	}
	.voice {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 12rem;
	}
	.voice-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.play {
		padding: 0.05rem 0.45rem;
	}
	.heard {
		font-size: 0.97rem;
		line-height: 1.6;
	}
	.voice-mode {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--text-2);
	}
	.composer.rec {
		align-items: center;
		border: 1px solid color-mix(in srgb, var(--bad) 50%, var(--line));
		border-radius: var(--radius);
		padding: 0.4rem 0.6rem;
		background: var(--bg-2);
	}
	.dot {
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
		background: var(--bad);
		animation: pulse 1.1s infinite;
		flex-shrink: 0;
	}
	.wave {
		flex: 1;
		height: 2rem;
		display: flex;
		align-items: center;
		gap: 2px;
		min-width: 0;
	}
	.wave span {
		flex: 1;
		background: var(--accent);
		border-radius: 2px;
		transition: height 0.08s linear;
	}
	.timer {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.warn-text {
		color: var(--warn);
	}
	@keyframes pulse {
		50% {
			opacity: 0.35;
		}
	}
</style>
