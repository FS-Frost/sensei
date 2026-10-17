<script lang="ts">
	// Conversación nueva: no existe en la base de datos hasta que envías el primer mensaje.
	import { page } from '$app/state';
	import { goto } from '#lib/client/nav.ts';
	import { isMode, MODE_DESC, MODE_LABEL, SUGGEST } from '#lib/tutorModes.ts';
	import ChatView from '#lib/components/chat/ChatView.svelte';
	import HelpLink from '#lib/components/HelpLink.svelte';

	const modeParam = $derived(page.url.searchParams.get('modo'));
	const mode = $derived(isMode(modeParam) ? modeParam : 'libre');
	let draft = $state('');
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
			bind:draft
			suggestions={SUGGEST[mode]}
			onsession={(id) => goto(`/tutor/${id}`, { replace: true })}
		/>
	{/key}
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		height: calc(100vh - 4.5rem);
		max-width: 820px;
		width: 100%;
	}
	h1 {
		margin: 0;
	}
	@media (max-width: 760px) {
		.page {
			height: calc(100vh - 7rem);
		}
	}
</style>
