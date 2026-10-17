<script lang="ts">
	import { onMount } from 'svelte';
	import { get, post, errMsg } from '#lib/client/api.ts';
	import Markdown from '#lib/components/Markdown.svelte';
	import HelpLink from '#lib/components/HelpLink.svelte';
	import CostNote from '#lib/components/CostNote.svelte';
	import type { OperationCost } from '#lib/cost.ts';

	type Metrics = {
		from: number;
		to: number;
		reviews: number;
		minutes: number;
		activeDays: number;
		retention: { key: string; label: string; n: number; rate: number }[];
		cpm: { avg: number | null; prevAvg: number | null; reads: number };
		desiredRetention: number;
	};
	type Report = { id: number; weekStart: number; text: string; createdAt: number; metrics: Metrics };

	let reports: Report[] = $state([]);
	let current: Metrics | null = $state(null);
	let busy = $state(false);
	let error = $state('');
	/** Costo del informe recién generado. */
	let cost: { id: number; cost: OperationCost | null } | null = $state(null);

	async function load() {
		const r = await get<{ reports: Report[]; current: Metrics }>('/api/report');
		reports = r.reports;
		current = r.current;
	}

	async function generate() {
		busy = true;
		error = '';
		try {
			const r = await post<{ id: number; cost: OperationCost | null }>('/api/report');
			await load();
			cost = { id: r.id, cost: r.cost };
		} catch (e) {
			error = errMsg(e);
		} finally {
			busy = false;
		}
	}

	const fresh = $derived(reports[0] && Date.now() - reports[0].createdAt < 7 * 86_400_000);

	onMount(() => {
		load()
			.then(() => {
				// Si no hay informe de esta semana, generarlo al entrar.
				if (!fresh && current && current.reviews > 0) generate();
			})
			.catch((e) => (error = errMsg(e)));
	});
</script>

<svelte:head><title>Informe semanal · Sensei</title></svelte:head>

<h1>Informe semanal <HelpLink section="informe" /></h1>
<p class="muted small">
	Una vez por semana: qué fue bien, qué preocupa y qué ajustar. La <strong>retención</strong> es el % de aciertos en repasos de
	tarjetas que ya llevaban 1+ día sin verse: es la cifra que dice si el ritmo es sostenible.
</p>

{#if current}
	<div class="card">
		<h2>Esta semana</h2>
		<div class="row small">
			<span class="badge">{current.reviews} respuestas</span>
			<span class="badge">{current.activeDays}/7 días</span>
			<span class="badge">~{current.minutes} min</span>
			{#if current.cpm.avg}<span class="badge">{current.cpm.avg} car/min</span>{/if}
		</div>
		{#if current.retention.length}
			<table class="small">
				<tbody>
					{#each current.retention as r (r.key)}
						<tr>
							<td>{r.label}</td>
							<td class="num">{Math.round(r.rate * 100)}%</td>
							<td class="dim">{r.n} resp.</td>
							<td>{r.rate < current.desiredRetention - 0.05 ? '⚠ por debajo del objetivo' : '✓'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="dim small">Objetivo de retención: {Math.round(current.desiredRetention * 100)}% (Ajustes).</p>
		{/if}
	</div>
{/if}

<div class="row">
	<button onclick={generate} disabled={busy}>
		{#if busy}<span class="spinner"></span>{/if} {fresh ? 'Regenerar informe' : 'Generar informe'}
	</button>
</div>
{#if error}<div class="error small">{error}</div>{/if}

{#each reports as r, i (r.id)}
	<article class="card" class:latest={i === 0}>
		<div class="small muted">Semana del {new Date(r.weekStart).toLocaleDateString('es')}</div>
		<Markdown text={r.text} />
		{#if cost?.id === r.id}<CostNote cost={cost.cost} />{/if}
	</article>
{:else}
	<p class="muted small">Aún no hay informes: el primero aparece tras una semana de uso.</p>
{/each}

<style>
	table {
		border-collapse: collapse;
		margin-top: 0.6rem;
	}
	td {
		padding: 0.25rem 0.8rem 0.25rem 0;
		border-bottom: 1px solid var(--line);
	}
	.num {
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
	.latest {
		border-color: var(--accent);
	}
</style>
