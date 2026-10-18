<script lang="ts">
	import { toast } from '#lib/client/toast.svelte.ts';
	import { onMount } from 'svelte';
	import { get, post, errMsg } from '#lib/client/api.ts';
	import type { JpToken } from '#lib/types.ts';
	import JpTokens from '#lib/components/JpTokens.svelte';
	import ReadTimer from '#lib/components/ReadTimer.svelte';
	import BarChart from '#lib/components/BarChart.svelte';
	import HelpLink from '#lib/components/HelpLink.svelte';

	type Log = { cpm: number; createdAt: number; furigana: string; textKind: string };
	let history: Log[] = $state([]);
	type Challenge = { id: number; title: string; lines: JpToken[][]; source: string };
	let challenge = $state<Challenge | null>(null);
	let loading = $state(false);

	async function loadHistory() {
		history = (await get<{ history: Log[] }>('/api/speed')).history;
	}

	async function newChallenge() {
		loading = true;
		try {
			challenge = await post<Challenge>('/api/speed');
		} catch (e) {
			toast.error('No se pudo preparar el reto', { detail: errMsg(e) });
		} finally {
			loading = false;
		}
	}

	const chars = $derived(challenge ? challenge.lines.reduce((n, l) => n + l.map((t) => t.s).join('').length, 0) : 0);
	const series = $derived(history.slice(-20));
	const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
	const last4 = $derived(avg(history.slice(-4).map((h) => h.cpm)));
	const first4 = $derived(avg(history.slice(0, 4).map((h) => h.cpm)));

	onMount(() => {
		loadHistory().catch((e) => toast.error('No se pudo preparar el reto', { detail: errMsg(e) }));
	});
</script>

<svelte:head><title>Velocidad · Sensei</title></svelte:head>

<h1>Velocidad de lectura <HelpLink section="velocidad" /></h1>
<p class="muted small">
	Leer manga o una novela exige automatismo, no solo reconocer. Una vez por semana, lee ~300 caracteres a tu nivel a tu ritmo
	natural, <strong>entendiendo</strong>, y mira cómo evoluciona. Como referencia, un lector nativo adulto lee 400-600 caracteres por minuto.
</p>

{#if history.length}
	<div class="card">
		<div class="spread">
			<h2>Tu evolución</h2>
			<span class="small muted">
				{#if first4 && last4 && history.length >= 5}primeras lecturas: {first4} → últimas: {last4} car/min{/if}
			</span>
		</div>
		<BarChart
			title="Caracteres por minuto en tus últimas lecturas cronometradas"
			labels={series.map((h) => new Date(h.createdAt).toLocaleDateString('es', { day: 'numeric', month: 'short' }))}
			values={series.map((h) => Math.round(h.cpm))}
			unit="car/min"
		/>
	</div>
{/if}

<div class="row">
	<button class="primary" onclick={newChallenge} disabled={loading}>
		{#if loading}<span class="spinner"></span>{/if} Nuevo reto
	</button>
	<span class="small dim">También cuentan las lecturas cronometradas de la Biblioteca y de las lecturas graduadas.</span>
</div>

{#if challenge}
	<ReadTimer {chars} textKind="speed" textId={challenge.id} previous={[]} onlogged={() => loadHistory()} />
	<article class="card reader">
		<h2 class="jp">{challenge.title}</h2>
		{#each challenge.lines as l, i (i)}
			<p><JpTokens tokens={l} serif /></p>
		{/each}
		<p class="small dim">{challenge.source === 'tatoeba' ? 'Frases de Tatoeba con solo kanji que ya conoces.' : 'Texto generado a tu nivel.'}</p>
	</article>
{/if}

<style>
	.reader {
		font-size: 1.3rem;
	}
	.reader p {
		margin: 0.3rem 0;
	}
</style>
