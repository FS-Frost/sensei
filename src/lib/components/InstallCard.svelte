<script lang="ts">
	// Invitación a instalar Sensei como app: Chromium (diálogo del navegador) o iPhone/iPad (instrucciones de Safari).
	// Se usa en el primer uso (descarga del diccionario, bienvenida) y en Inicio. «Ahora no» la oculta en este dispositivo.
	import { onMount } from 'svelte';
	import { dismissInstall, install, installDismissed, isIos, promptInstall } from '../client/install.svelte.ts';

	let { dismissible = true }: { dismissible?: boolean } = $props();

	let hidden = $state(true);
	let ios = $state(false);
	onMount(() => {
		ios = isIos();
		hidden = dismissible && installDismissed();
	});
	const show = $derived(!hidden && !install.installed && (install.available || ios));
</script>

{#if show}
	<div class="card small row install">
		<span>
			📲 <strong>Instala Sensei como app</strong>: icono propio, abre sin conexión, atajos, recordatorio de repasos y «Compartir →
			Sensei» desde otras apps.
			{#if ios && !install.available}En Safari: <strong>Compartir</strong> → <strong>Añadir a pantalla de inicio</strong>.{/if}
		</span>
		{#if install.available}<button class="small primary" onclick={() => promptInstall()}>Instalar</button>{/if}
		{#if dismissible}
			<button
				class="small ghost"
				onclick={() => {
					dismissInstall();
					hidden = true;
				}}>Ahora no</button
			>
		{/if}
	</div>
{/if}

<style>
	.install {
		border-left: 3px solid var(--accent);
	}
</style>
