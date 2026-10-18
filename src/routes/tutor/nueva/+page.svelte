<script lang="ts">
	// Conversación nueva: no existe en la base de datos hasta que envías el primer mensaje.
	import { page } from '$app/state';
	import { goto } from '#lib/client/nav.ts';
	import { isMode, MODE_DESC, MODE_LABEL, SUGGEST } from '#lib/tutorModes.ts';
	import ChatView from '#lib/components/chat/ChatView.svelte';
	import HelpLink from '#lib/components/HelpLink.svelte';
	import { get } from '#lib/client/api.ts';
	import { completeDaily } from '#lib/client/daily.svelte.ts';
	import type { ScreenContext } from '#lib/types.ts';

	const modeParam = $derived(page.url.searchParams.get('modo'));
	const mode = $derived(isMode(modeParam) ? modeParam : 'libre');
	let draft = $state('');

	// Cierre de la sesión diaria: lo hecho hoy va como contexto del primer mensaje; enviarlo completa el paso.
	let dayContext = $state<ScreenContext | null>(null);
	$effect(() => {
		if (mode !== 'cierre') return;
		get<{ summaryText: string }>('/api/daily')
			.then((r) => (dayContext = { kind: 'daily', label: 'lo que hiciste hoy', data: { resumen: r.summaryText } }))
			.catch(() => {});
	});
</script>

<svelte:head><title>{MODE_LABEL[mode]} · Sensei</title></svelte:head>

<div class="page">
	<div>
		<a href="/tutor" class="small">← Sesiones</a>
		<h1>{MODE_LABEL[mode]} <HelpLink section="tutor" /></h1>
		<span class="small muted">{MODE_DESC[mode]}</span>
	</div>
	{#key mode}
		<ChatView
			sessionId={null}
			{mode}
			origin={mode === 'cierre' ? 'daily' : 'page'}
			context={dayContext}
			onclearcontext={() => (dayContext = null)}
			bind:draft
			suggestions={SUGGEST[mode]}
			onsent={() => mode === 'cierre' && completeDaily('close')}
			onsession={(id) => goto(`/tutor/${id}`, { replace: true })}
		/>
	{/key}
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		height: calc(100vh - 4.5rem - var(--top-h, 0px));
		max-width: 820px;
		width: 100%;
	}
	h1 {
		margin: 0;
	}
	@media (max-width: 760px) {
		.page {
			height: calc(100vh - 7rem - var(--top-h, 0px));
		}
	}
</style>
