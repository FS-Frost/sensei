<script lang="ts">
	// ¿Usarás la IA? Se pregunta una vez (sin key y sin decidir): sí → Ajustes para pegar la key; no → modo sin IA.
	// La usan el layout (tarjeta arriba) y la bienvenida (un paso).
	import { setAiMode } from '../client/ai.svelte.ts';
	import { goto } from '../client/nav.ts';
	import { toast } from '../client/toast.svelte.ts';
	import { errMsg } from '../client/api.ts';

	let { compact = false, ondone }: { compact?: boolean; ondone?: (mode: 'on' | 'off') => void } = $props();
	let busy = $state(false);

	async function choose(mode: 'on' | 'off') {
		busy = true;
		try {
			await setAiMode(mode);
			if (mode === 'off')
				toast.success('Modo sin IA', { detail: 'Puedes activarla cuando quieras en Ajustes → Inteligencia artificial.', duration: 6000 });
			ondone?.(mode);
			if (mode === 'on' && !ondone) await goto('/ajustes#gemini');
		} catch (e) {
			toast.error('No se pudo guardar', { detail: errMsg(e) });
		} finally {
			busy = false;
		}
	}
</script>

<div class="ai-choice" class:card={!compact}>
	<div class="stack">
		<strong>¿Usarás la IA (Gemini)?</strong>
		<p class="small muted">
			Con IA: tutor, lecturas graduadas a tu nivel, explicador de textos y fotos, «¿Por qué?» en los repasos y mnemotecnias para
			los kanji que aún no traen (necesita tu API key gratuita de Google). Sin IA: SRS, lecciones, diccionario, biblioteca,
			velocidad e informes funcionan igual, con el contenido ya preparado. Puedes cambiarlo luego en Ajustes.
		</p>
	</div>
	<div class="row">
		<button class="primary" onclick={() => choose('on')} disabled={busy}>Sí, usar IA</button>
		<button onclick={() => choose('off')} disabled={busy}>No, seguir sin IA</button>
	</div>
</div>

<style>
	.ai-choice {
		display: grid;
		gap: 0.6rem;
		border-left: 3px solid var(--accent-2);
	}
	.ai-choice p {
		margin: 0.2rem 0 0;
	}
</style>
