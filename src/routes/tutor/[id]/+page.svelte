<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '#lib/client/nav.ts';
	import { del, get, post, errMsg } from '#lib/client/api.ts';
	import type { ChatMode } from '#lib/types.ts';
	import { MODE_LABEL, SUGGEST } from '#lib/tutorModes.ts';
	import ChatView from '#lib/components/chat/ChatView.svelte';
	import HelpLink from '#lib/components/HelpLink.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import { fmtUsd } from '#lib/cost.ts';

	type Session = { id: number; mode: ChatMode; title: string | null };
	let session: Session | null = $state(null);
	let costUsd = $state(0);
	let summary = $state('');
	let ending = $state(false);
	let error = $state('');
	let deleteOpen = $state(false);
	let draft = $state('');
	const id = $derived(Number(page.params.id));

	async function loadSession() {
		const r = await get<{ session: Session; costUsd: number }>(`/api/chat/${id}`);
		session = r.session;
		costUsd = r.costUsd;
	}

	async function end() {
		ending = true;
		try {
			const r = await post<{ summary: string | null }>(`/api/chat/${id}/end`);
			summary = r.summary ?? 'Sesión demasiado corta para resumir.';
			await loadSession();
		} catch (e) {
			error = errMsg(e);
		} finally {
			ending = false;
		}
	}

	async function remove() {
		await del(`/api/chat/${id}`);
		goto('/tutor');
	}

	onMount(() => {
		loadSession().catch((e) => (error = errMsg(e)));
	});
</script>

<svelte:head><title>{session?.title ?? 'Tutor'} · Sensei</title></svelte:head>

<div class="page">
	<div class="spread head">
		<div>
			<a href="/tutor" class="small">← Sesiones</a>
			<h1>{session ? (session.title ?? MODE_LABEL[session.mode]) : 'Tutor'} <HelpLink section="tutor" /></h1>
			{#if session}
				<span class="small muted">{MODE_LABEL[session.mode]}</span>
				{#if costUsd}<a class="small dim cost" href="/costos" title="Gasto en Gemini de esta sesión">· {fmtUsd(costUsd)}</a>{/if}
			{/if}
		</div>
		<div class="row">
			<button class="small" onclick={end} disabled={ending} title="Guarda un resumen para que el tutor lo recuerde">
				{#if ending}<span class="spinner"></span>{/if} Terminar y resumir
			</button>
			<button class="small ghost" onclick={() => (deleteOpen = true)} title="Borrar sesión">🗑</button>
		</div>
	</div>
	{#if summary}<div class="card small"><strong>Resumen guardado:</strong> {summary}</div>{/if}
	{#if error}<div class="error small">{error}</div>{/if}
	{#if session}
		{#key id}
			<ChatView
				sessionId={id}
				mode={session.mode}
				bind:draft
				suggestions={SUGGEST[session.mode]}
				onsent={() => loadSession().catch(() => {})}
			/>
		{/key}
	{/if}
</div>

<ConfirmDialog bind:open={deleteOpen} title="Borrar sesión" confirmLabel="Borrar" onconfirm={remove}>
	<p>¿Borrar «{session?.title}» y sus mensajes? Su resumen deja de contar en la memoria del tutor.</p>
</ConfirmDialog>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		height: calc(100vh - 4.5rem - var(--top-h, 0px));
		max-width: 820px;
		width: 100%;
	}
	.head h1 {
		margin: 0;
	}
	.cost {
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
	@media (max-width: 760px) {
		.page {
			height: calc(100vh - 7rem - var(--top-h, 0px));
		}
	}
</style>
