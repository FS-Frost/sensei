<script lang="ts">
	import HelpLink from '#lib/components/HelpLink.svelte';
	import { onMount } from 'svelte';
	import { refreshAll } from '$app/navigation';
	import { get, errMsg } from '#lib/client/api.ts';
	import type { ReviewItem } from '#lib/types.ts';
	import ReviewSession from '#lib/components/ReviewSession.svelte';

	let items: ReviewItem[] | null = $state(null);
	let total = $state(0);
	let error = $state('');
	let finished = $state(false);

	async function load() {
		error = '';
		finished = false;
		items = null;
		try {
			const r = await get<{ items: ReviewItem[]; total: number }>('/api/review?limit=100');
			items = r.items;
			total = r.total;
		} catch (e) {
			error = errMsg(e);
		}
	}

	onMount(load);
</script>

<svelte:head><title>Repaso · Sensei</title></svelte:head>

<div class="spread">
	<h1>Repaso <HelpLink section="repaso" /></h1>
	{#if total > 100}<span class="muted small">Mostrando 100 de {total}</span>{/if}
</div>

{#if error}
	<div class="error">{error}</div>
{:else if items === null}
	<span class="spinner"></span>
{:else if !items.length}
	<div class="card">
		<p>No hay repasos pendientes. 🎉</p>
		<a class="btn primary" href="/leccion">Hacer una lección</a>
	</div>
{:else}
	{#key items}
		<ReviewSession
			{items}
			source="review"
			onfinish={() => {
				finished = true;
				refreshAll();
			}}
		/>
	{/key}
	{#if finished}
		<div class="row" style="justify-content:center">
			<button onclick={load}>Buscar más repasos</button>
			<a class="btn" href="/leccion">Lección</a>
			<a class="btn" href="/">Inicio</a>
		</div>
	{/if}
{/if}
