<script lang="ts">
	import HelpLink from '#lib/components/HelpLink.svelte';
	import { goto } from '#lib/client/nav.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let filter: 'all' | 'studied' | 'pending' = $state('all');
	let q = $state('');

	const LABELS = ['sin estudiar', 'aprendiendo', 'en repaso', 'dominado'];
	const counts = $derived([0, 1, 2, 3].map((s) => data.kanji.filter((k) => k.s === s).length));
	const shown = $derived(
		data.kanji.filter((k) => (filter === 'all' ? true : filter === 'studied' ? k.s > 0 : k.s === 0))
	);

	function search(e: SubmitEvent) {
		e.preventDefault();
		const ch = [...q.trim()][0];
		if (ch) goto(`/kanji/${encodeURIComponent(ch)}`);
	}
</script>

<svelte:head><title>Kanji · Sensei</title></svelte:head>

<div class="spread">
	<h1>Mapa de kanji <HelpLink section="kanji" /></h1>
	<form class="row" onsubmit={search}>
		<input bind:value={q} placeholder="Buscar kanji" class="jp" style="width:10rem" />
	</form>
</div>

<div class="row small">
	{#each LABELS as l, i (l)}
		<span class="legend"><i class="s{i}"></i>{l} {counts[i]}</span>
	{/each}
</div>

<div class="row">
	<button class="small" class:on={filter === 'all'} onclick={() => (filter = 'all')}>Todos ({data.kanji.length})</button>
	<button class="small" class:on={filter === 'studied'} onclick={() => (filter = 'studied')}>Estudiados</button>
	<button class="small" class:on={filter === 'pending'} onclick={() => (filter = 'pending')}>Pendientes</button>
</div>

<p class="dim small">En orden de aprendizaje (componentes + frecuencia).</p>

<div class="grid-k jp">
	{#each shown as k (k.c)}
		<a href="/kanji/{k.c}" class="cell s{k.s}" title="{k.m} · {LABELS[k.s]}">{k.c}</a>
	{/each}
</div>

<style>
	.grid-k {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(2.6rem, 1fr));
		gap: 3px;
	}
	.cell {
		aspect-ratio: 1;
		display: grid;
		place-items: center;
		font-size: 1.35rem;
		border-radius: 6px;
		color: var(--text);
		text-decoration: none;
	}
	.cell:hover {
		outline: 2px solid var(--text-2);
		text-decoration: none;
	}
	/* Rampa ordinal azul (mismos pasos que el medidor de progreso) */
	.s0 {
		background: var(--bg-2);
		color: var(--text-3);
	}
	.s1 {
		background: var(--ord-1);
		color: var(--ord-1-ink);
	}
	.s2 {
		background: var(--ord-2);
		color: var(--ord-2-ink);
	}
	.s3 {
		background: var(--ord-3);
		color: var(--ord-3-ink);
	}
	.legend i {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 2px;
		margin-right: 0.35rem;
		border: 1px solid var(--line);
	}
	.on {
		border-color: var(--info);
	}
</style>
