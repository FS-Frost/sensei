<script lang="ts">
	// Conversación con el tutor (página completa o panel lateral).
	// Sin sesión: borrador; el primer mensaje crea la sesión (/api/chat/start) y avisa con `onsession`.
	import { tick, untrack } from 'svelte';
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
		origin?: 'page' | 'panel';
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
		quizAnswers?: { quizId: string; answers: { id: string; answer: string }[] };
		retry?: boolean;
	}) {
		if (busy) return;
		if (!sid && !payload.text) return;
		busy = true;
		error = '';
		incomplete = false;
		const ctx = payload.retry ? null : context;
		if (payload.text)
			messages = [
				...messages,
				{
					id: `u${Date.now()}`,
					role: 'user',
					ui: [...(ctx ? [{ type: 'context', label: ctx.label } as UiBlock] : []), { type: 'text', text: payload.text }]
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
			const body = sid ? { ...payload, context: ctx } : { mode, origin, text: payload.text, context: ctx };
			for await (const ev of postStream<Ev>(url, body)) {
				if (ev.type === 'session') {
					createdId = ev.id;
					sid = ev.id;
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
		await load().catch(() => {});
		if (createdId) onsession?.(createdId);
	}

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
						{#if m.role === 'user'}<div class="bubble jp">{b.text}</div>{:else}<div class="bubble"><Markdown text={b.text} /></div>{/if}
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
			<button class="small" class:on={kanaInput} onclick={() => (kanaInput = !kanaInput)} title="Convierte el romaji a hiragana mientras escribes"
				>あ</button
			>
			<button class="primary" onclick={submitText} disabled={busy}>Enviar</button>
		</div>
	</div>
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
</style>
