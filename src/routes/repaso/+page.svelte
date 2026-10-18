<script lang="ts">
	import HelpLink from '#lib/components/HelpLink.svelte';
	import { onMount } from 'svelte';
	import { refreshAll } from '$app/navigation';
	import { get, errMsg } from '#lib/client/api.ts';
	import type { ReviewItem } from '#lib/types.ts';
	import ReviewSession from '#lib/components/ReviewSession.svelte';
	import { page } from '$app/state';
	import { completeDaily } from '#lib/client/daily.svelte.ts';
	import { toast } from '#lib/client/toast.svelte.ts';

	let items: ReviewItem[] | null = $state(null);
	let total = $state(0);
	let failed = $state(false);
	let finished = $state(false);
	// Desde la sesión de hoy: tope de tarjetas (el resto queda para otra vez).
	const limit = $derived(Math.min(100, Math.max(1, Number(page.url.searchParams.get('limite')) || 100)));
	const fromDaily = $derived(page.url.searchParams.has('hoy'));

	async function load() {
		failed = false;
		finished = false;
		items = null;
		try {
			const r = await get<{ items: ReviewItem[]; total: number }>(`/api/review?limit=${limit}`);
			items = r.items;
			total = r.total;
			if (!items.length) completeDaily('review');
		} catch (e) {
			failed = true;
			toast.error('No se pudieron cargar los repasos', { detail: errMsg(e) });
		}
	}

	onMount(load);
</script>

<svelte:head><title>Repaso · Sensei</title></svelte:head>

<div class="spread">
	<h1>Repaso <HelpLink section="repaso" /></h1>
	{#if total > limit}<span class="muted small">{fromDaily ? 'Sesión de hoy' : 'Mostrando'}: {limit} de {total}</span>{/if}
</div>

{#if failed}
	<div class="card"><button onclick={load}>Reintentar</button></div>
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
				completeDaily('review');
				refreshAll();
			}}
		/>
	{/key}
	{#if finished && !fromDaily}
		<div class="row" style="justify-content:center">
			<button onclick={load}>Buscar más repasos</button>
			<a class="btn" href="/leccion">Lección</a>
			<a class="btn" href="/">Inicio</a>
		</div>
	{/if}
{/if}
