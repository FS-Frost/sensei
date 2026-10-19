<script lang="ts">
	// Versión nueva de la app (short sha del commit publicado), avisada con toasts (client/toast.svelte.ts):
	// - al volver a la pestaña, si hay una publicada, se actualiza sola (recarga);
	// - si llega mientras la pestaña está a la vista, toast con «Actualizar» (no recarga en mitad de un repaso);
	// - «Actualizar» muestra «Actualizando…»; si la versión aún se está publicando (CDN) o no hay conexión, lo dice;
	// - tras actualizar, «Sensei se actualizó (sha) · publicada hace N»; si la recarga no trajo la versión pedida,
	//   error con «Forzar» (quita el service worker y la caché de la app, no los datos).
	import { onMount } from 'svelte';
	import { updated } from '$app/state';
	import { version } from '$app/env';
	import { applyUpdate, failedUpdate, forceReload } from '../client/pwa.ts';
	import { ago, noteVersion } from '../client/version.ts';
	import { toast } from '../client/toast.svelte.ts';

	const builtAt = import.meta.env.VITE_BUILT_AT as string | undefined;

	function offer() {
		toast.info('Hay una versión nueva de Sensei', {
			duration: null,
			key: 'version',
			actions: [{ label: 'Actualizar', run: update, keep: true }]
		});
	}

	async function update() {
		toast.info('Actualizando Sensei…', { duration: null, key: 'version', persistent: true, detail: 'Se recargará en unos segundos.' });
		const r = await applyUpdate();
		if (r === 'publishing')
			toast.warn('La versión nueva aún se está publicando', {
				detail: 'El servidor todavía entrega la anterior. Prueba de nuevo en un par de minutos.',
				duration: null,
				key: 'version',
				actions: [{ label: 'Reintentar', run: update, keep: true }]
			});
		else if (r === 'offline')
			toast.warn('Sin conexión: no se pudo actualizar', { key: 'version', actions: [{ label: 'Reintentar', run: update, keep: true }] });
	}

	onMount(() => {
		const missed = version === 'dev' ? null : failedUpdate(version);
		if (missed)
			toast.error(`No se cargó la versión nueva (${missed})`, {
				detail: 'Sigues en la anterior. «Forzar» descarga la app de nuevo (tus datos no se tocan).',
				key: 'version',
				actions: [{ label: 'Forzar', run: forceReload, keep: true }]
			});
		else if (noteVersion(version) !== null)
			toast.success(`Sensei se actualizó (${version})`, { detail: builtAt ? `Publicada ${ago(builtAt)}.` : undefined, duration: 8000, key: 'version' });
		const onVisible = async () => {
			if (document.visibilityState !== 'visible' || version === 'dev') return;
			try {
				// Sola y en silencio: si aún se está publicando, ya se ofrecerá con el toast.
				if (updated.current || (await updated.check())) await applyUpdate();
			} catch {
				/* sin conexión: se comprobará la próxima vez */
			}
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => document.removeEventListener('visibilitychange', onVisible);
	});

	// Detectada mientras la pestaña está a la vista (sondeo de Kit): ofrecer, no imponer.
	$effect(() => {
		if (updated.current) offer();
	});
</script>
