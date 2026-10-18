<script lang="ts">
	// Leer palabras reales escritas solo con los kana que ya estudiaste (diccionario, sin IA): ves la palabra,
	// escribes su romaji y descubres qué significa. Da soltura desde la primera fila.
	import { get, errMsg } from '../client/api.ts';
	import AnswerInput from './AnswerInput.svelte';
	import SpeakButton from './SpeakButton.svelte';
	import { completeDaily } from '../client/daily.svelte.ts';

	type Word = { id: string; word: string; romaji: string[]; meaning: string };

	let words: Word[] = $state([]);
	let available = $state(0);
	let i = $state(0);
	let answer = $state('');
	let shown: { ok: boolean } | null = $state(null);
	let right = $state(0);
	let loading = $state(false);
	let error = $state('');
	let started = $state(false);

	async function start() {
		loading = true;
		error = '';
		try {
			const r = await get<{ words: Word[]; available: number }>('/api/kana/words?n=10');
			words = r.words;
			available = r.available;
			i = 0;
			right = 0;
			shown = null;
			answer = '';
			started = true;
		} catch (e) {
			error = errMsg(e);
		} finally {
			loading = false;
		}
	}

	function submit() {
		const w = words[i];
		if (!w) return;
		if (shown) {
			shown = null;
			answer = '';
			if (++i >= words.length) completeDaily('reading');
			return;
		}
		const a = answer.trim().toLowerCase().replace(/[\s'-]/g, '');
		const ok = w.romaji.includes(a);
		if (ok) right++;
		shown = { ok };
	}
</script>

<div class="stack">
	{#if !started}
		<p class="small muted">
			Palabras reales escritas solo con los kana que ya estudiaste. Léelas, escribe el romaji y mira qué significan: leer
			palabras de verdad da soltura antes de los kanji.
		</p>
		<div><button class="primary" onclick={start} disabled={loading}>{#if loading}<span class="spinner"></span>{/if} Practicar 10 palabras</button></div>
		{#if error}<p class="small warning">{error}</p>{/if}
	{:else if !words.length}
		<p class="small muted">Aún no hay palabras que puedas leer: aprende una o dos filas más y vuelve.</p>
	{:else if i < words.length}
		{@const w = words[i]}
		<div class="small muted">{i + 1} / {words.length} · {available} palabras posibles con tus kana</div>
		<div class="word jp" class:ok={shown?.ok} class:bad={shown && !shown.ok}>{w.word}</div>
		{#if shown}
			<div class="reveal">
				<strong>{shown.ok ? '✓' : '✗'} {w.romaji[0]}</strong> — {w.meaning}
				<SpeakButton text={w.word} />
			</div>
		{/if}
		<AnswerInput bind:value={answer} mode="romaji" disabled={!!shown} onsubmit={submit} />
		{#if shown}<button class="primary" onclick={submit}>Siguiente ↵</button>{/if}
	{:else}
		<p><strong>{right} / {words.length}</strong> bien leídas.</p>
		<div><button onclick={start}>Otras 10</button></div>
	{/if}
</div>

<style>
	.word {
		font-size: 3rem;
		text-align: center;
		padding: 0.6rem;
		border-radius: var(--radius);
		background: var(--bg-3);
	}
	.word.ok {
		box-shadow: inset 0 0 0 2px var(--ok);
	}
	.word.bad {
		box-shadow: inset 0 0 0 2px var(--bad);
	}
	.reveal {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		flex-wrap: wrap;
	}
</style>
