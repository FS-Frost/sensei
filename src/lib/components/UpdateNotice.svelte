<script lang="ts">
	// Versión nueva de la app (short sha del commit publicado):
	// - al volver a la pestaña, si hay una publicada, se actualiza sola (recarga);
	// - si llega mientras la pestaña está a la vista, botón «Actualizar» (no recarga en mitad de un repaso);
	// - tras actualizar, aviso «Sensei se actualizó (sha) · publicada hace N».
	import { onMount } from 'svelte';
	import { updated } from '$app/state';
	import { version } from '$app/env';
	import { applyUpdate } from '../client/pwa.ts';
	import { ago, noteVersion } from '../client/version.ts';

	const builtAt = import.meta.env.VITE_BUILT_AT as string | undefined;
	let justUpdated = $state(false);
	let now = $state(Date.now());

	onMount(() => {
		justUpdated = noteVersion(version) !== null;
		const hide = justUpdated ? setTimeout(() => (justUpdated = false), 20_000) : undefined;
		const clock = setInterval(() => (now = Date.now()), 30_000);
		const onVisible = async () => {
			if (document.visibilityState !== 'visible' || version === 'dev') return;
			try {
				if (updated.current || (await updated.check())) await applyUpdate();
			} catch {
				/* sin conexión: se comprobará la próxima vez */
			}
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearTimeout(hide);
			clearInterval(clock);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});
</script>

{#if updated.current}
	<div class="toast card row small" role="status">
		<span>Hay una versión nueva de Sensei.</span>
		<button class="small primary" onclick={() => applyUpdate()}>Actualizar</button>
	</div>
{:else if justUpdated}
	<div class="toast card row small" role="status">
		<span>✓ Sensei se actualizó (<code>{version}</code>){#if builtAt} · publicada {ago(builtAt, now)}{/if}.</span>
		<button class="small ghost" aria-label="Cerrar" onclick={() => (justUpdated = false)}>✕</button>
	</div>
{/if}

<style>
	.toast {
		position: fixed;
		z-index: 60;
		right: 1rem;
		bottom: 1rem;
		max-width: min(420px, calc(100vw - 2rem));
		padding: 0.6rem 0.8rem;
		align-items: center;
		flex-wrap: nowrap;
		box-shadow: 0 6px 24px rgb(0 0 0 / 0.25);
	}
	@media (max-width: 760px) {
		/* Encima de la barra de navegación inferior. */
		.toast {
			left: 0.6rem;
			right: 0.6rem;
			bottom: calc(4.4rem + env(safe-area-inset-bottom));
			max-width: none;
		}
	}
</style>
