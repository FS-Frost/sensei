<script lang="ts">
	import HelpLink from '#lib/components/HelpLink.svelte';
	import SessionsTable from '#lib/components/SessionsTable.svelte';
	import { LISTED_MODES, MODE_DESC, MODE_LABEL } from '#lib/tutorModes.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>Tutor · Sensei</title></svelte:head>

<h1>Tutor <HelpLink section="tutor" /></h1>
<p class="small muted">
	También lo tienes en el botón 話 de cualquier pantalla: sabe lo que estás viendo.
</p>

<div class="modes">
	{#each LISTED_MODES as mode (mode)}
		<a class="card mode" href="/tutor/nueva?modo={mode}">
			<strong>{MODE_LABEL[mode]}</strong>
			<span class="small muted">{MODE_DESC[mode]}</span>
		</a>
	{/each}
</div>

<h2>Sesiones anteriores</h2>
<SessionsTable sessions={data.sessions} />

<style>
	.modes {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.8rem;
	}
	.mode {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		color: var(--text);
	}
	.mode:hover {
		text-decoration: none;
		border-color: var(--accent);
	}
</style>
