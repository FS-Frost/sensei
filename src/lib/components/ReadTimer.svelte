<script lang="ts">
	// Cronómetro de lectura: mide caracteres por minuto y programa la relectura del texto.
	import { onDestroy } from 'svelte';
	import { post, errMsg } from '../client/api.ts';
	import { prefs } from '../client/state.svelte.ts';
	import { keepAwake } from '../client/wakeLock.ts';
	import { completeDaily } from '../client/daily.svelte.ts';

	type Log = { cpm: number; createdAt: number; furigana: string };

	let {
		chars,
		textKind,
		textId,
		previous = [],
		comprehension = null,
		onlogged
	}: {
		chars: number;
		textKind: 'graded' | 'library' | 'speed';
		textId: number;
		previous?: Log[];
		comprehension?: number | null;
		onlogged?: (r: { log: Log; reads: Log[]; nextReread: number | null }) => void;
	} = $props();

	let startedAt: number | null = $state(null);
	let elapsed = $state(0);
	let result: { log: Log; nextReread: number | null } | null = $state(null);
	let error = $state('');
	let timer: ReturnType<typeof setInterval> | undefined;
	let release: (() => void) | null = null; // pantalla encendida mientras corre el cronómetro

	function start() {
		result = null;
		error = '';
		release?.();
		release = keepAwake();
		startedAt = Date.now();
		elapsed = 0;
		timer = setInterval(() => (elapsed = Date.now() - (startedAt ?? Date.now())), 250);
	}

	async function finish() {
		if (!startedAt) return;
		clearInterval(timer);
		release?.();
		release = null;
		const durationMs = Date.now() - startedAt;
		startedAt = null;
		try {
			const r = await post<{ log: Log; reads: Log[]; nextReread: number | null }>('/api/reading-log', {
				textKind,
				textId,
				chars,
				durationMs,
				furigana: prefs.furigana,
				comprehension
			});
			result = r;
			completeDaily('reading'); // cualquier lectura cronometrada cuenta para la sesión de hoy
			onlogged?.(r);
		} catch (e) {
			error = errMsg(e);
		}
	}

	onDestroy(() => {
		clearInterval(timer);
		release?.();
	});

	const best = $derived(previous.length ? Math.max(...previous.map((p) => p.cpm)) : null);
	const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
</script>

<div class="timer card small">
	{#if startedAt}
		<span class="clock">⏱ {fmt(elapsed)}</span>
		<button class="primary small" onclick={finish}>Terminé de leer</button>
		<span class="muted">Lee a tu ritmo natural, entendiendo. No es una carrera.</span>
	{:else}
		<button class="small" onclick={start}>⏱ {previous.length ? 'Releer cronometrando' : 'Leer cronometrando'}</button>
		<span class="muted">{chars} caracteres{best ? ` · tu mejor marca: ${Math.round(best)} car/min` : ''}</span>
	{/if}
	{#if result}
		<span>
			<strong>{Math.round(result.log.cpm)} car/min</strong>
			{#if previous.length}
				({result.log.cpm >= previous[previous.length - 1].cpm ? '▲' : '▼'} vs. {Math.round(previous[previous.length - 1].cpm)} la vez anterior)
			{/if}
			{#if result.nextReread}· próxima relectura: {new Date(result.nextReread).toLocaleDateString('es')}{/if}
		</span>
	{/if}
	{#if error}<span class="error">{error}</span>{/if}
</div>

<style>
	.timer {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: center;
		padding: 0.6rem 0.8rem;
	}
	.clock {
		font-variant-numeric: tabular-nums;
		font-size: 1.1rem;
	}
</style>
