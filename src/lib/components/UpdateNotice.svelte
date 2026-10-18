<script lang="ts">
	// Versión nueva de la app (short sha del commit publicado), avisada con toasts (client/toast.svelte.ts):
	// - al volver a la pestaña, si hay una publicada, se actualiza sola (recarga);
	// - si llega mientras la pestaña está a la vista, toast con «Actualizar» (no recarga en mitad de un repaso);
	// - tras actualizar, «Sensei se actualizó (sha) · publicada hace N».
	import { onMount } from 'svelte';
	import { updated } from '$app/state';
	import { version } from '$app/env';
	import { applyUpdate } from '../client/pwa.ts';
	import { ago, noteVersion } from '../client/version.ts';
	import { toast } from '../client/toast.svelte.ts';

	const builtAt = import.meta.env.VITE_BUILT_AT as string | undefined;

	onMount(() => {
		if (noteVersion(version) !== null)
			toast.success(`Sensei se actualizó (${version})`, { detail: builtAt ? `Publicada ${ago(builtAt)}.` : undefined, duration: 8000, key: 'version' });
		const onVisible = async () => {
			if (document.visibilityState !== 'visible' || version === 'dev') return;
			try {
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
		if (!updated.current) return;
		toast.info('Hay una versión nueva de Sensei', {
			duration: null,
			key: 'version',
			actions: [{ label: 'Actualizar', run: () => applyUpdate(), keep: true }]
		});
	});
</script>
