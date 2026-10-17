<script lang="ts">
	import type { Quiz, QuizAnswer } from '../types.ts';
	import AnswerInput from './AnswerInput.svelte';
	import Furigana from './Furigana.svelte';
	import SpeakButton from './SpeakButton.svelte';

	let {
		quiz,
		answers,
		disabled = false,
		onsubmit
	}: {
		quiz: Quiz;
		answers?: QuizAnswer[];
		disabled?: boolean;
		onsubmit?: (answers: { id: string; answer: string }[]) => void;
	} = $props();

	let values: Record<string, string> = $state({});
	// Inicializar antes de enlazar (bind a undefined con fallback no está permitido).
	$effect.pre(() => {
		for (const q of quiz.questions) if (values[q.id] === undefined) values[q.id] = '';
	});
	const graded = $derived(answers && answers.length ? new Map(answers.map((a) => [a.id, a])) : null);
	const skipped = $derived(answers !== undefined && answers.length === 0);
	const score = $derived(answers?.filter((a) => a.correct).length ?? 0);
	const complete = $derived(quiz.questions.every((q) => (values[q.id] ?? '').trim()));

	function submit() {
		if (!complete || disabled || graded) return;
		onsubmit?.(quiz.questions.map((q) => ({ id: q.id, answer: values[q.id] ?? '' })));
	}

	function focusNext(i: number) {
		const next = quiz.questions[i + 1];
		if (!next) submit();
		else document.getElementById(`q-${quiz.id}-${next.id}`)?.querySelector('input')?.focus();
	}

	const MODE = { reading: 'kana', fill_blank: 'kana', meaning: 'meaning' } as const;
</script>

<div class="quiz card">
	<div class="spread">
		<strong>📝 {quiz.title}</strong>
		{#if graded}<span class="badge">{score}/{quiz.questions.length}</span>{/if}
		{#if skipped}<span class="badge">omitido</span>{/if}
	</div>

	{#each quiz.questions as q, i (q.id)}
		{@const g = graded?.get(q.id)}
		<div class="q" id="q-{quiz.id}-{q.id}" class:ok={g?.correct} class:bad={g && !g.correct}>
			<div class="small muted">{i + 1}. {q.prompt}</div>
			{#if q.jp}
				<div class="jp big">
					<Furigana text={q.jp} />
					<SpeakButton text={q.jp} />
				</div>
			{/if}

			{#if q.type === 'multiple_choice' && q.options}
				<div class="opts">
					{#each q.options as o (o)}
						<button
							class="opt jp"
							class:sel={(g ? g.answer : values[q.id]) === o}
							class:right={g && o === q.answer}
							disabled={!!g || skipped || disabled}
							onclick={() => (values[q.id] = o)}><Furigana text={o} /></button
						>
					{/each}
				</div>
			{:else if g}
				<div class="jp">Tu respuesta: <strong>{g.answer || '—'}</strong></div>
			{:else if !skipped && values[q.id] !== undefined}
				<AnswerInput
					bind:value={values[q.id]}
					mode={MODE[q.type as keyof typeof MODE] ?? 'meaning'}
					{disabled}
					onsubmit={() => focusNext(i)}
				/>
			{/if}

			{#if g}
				<div class="small">
					{g.correct ? '✓' : '✗'} <span class="jp">{q.answer}</span>
					{#if q.explanation}<div class="muted">{q.explanation}</div>{/if}
				</div>
			{/if}
		</div>
	{/each}

	{#if !graded && !skipped}
		<button class="primary" onclick={submit} disabled={!complete || disabled}>Enviar respuestas</button>
	{/if}
</div>

<style>
	.quiz {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		border-color: color-mix(in srgb, var(--info) 40%, var(--line));
	}
	.q {
		border-left: 3px solid var(--line);
		padding-left: 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.q.ok {
		border-left-color: var(--ok);
	}
	.q.bad {
		border-left-color: var(--bad);
	}
	.big {
		font-size: 1.5rem;
	}
	.opts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 0.4rem;
	}
	.opt.sel {
		border-color: var(--info);
		background: color-mix(in srgb, var(--info) 18%, var(--bg-3));
	}
	.opt.right {
		border-color: var(--ok);
	}
	.q :global(.answer) {
		font-size: 1.05rem;
		text-align: left;
		padding: 0.5rem 0.7rem;
	}
</style>
