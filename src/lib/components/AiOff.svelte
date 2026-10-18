<script lang="ts">
	// En modo sin IA, en lugar de una página de IA (tutor, lectura graduada, explicador, costos).
	import { setAiMode, aiKey, aiMode } from '../client/ai.svelte.ts';
	import { goto } from '../client/nav.ts';
	import { toast } from '../client/toast.svelte.ts';
	import { errMsg } from '../client/api.ts';

	let busy = $state(false);
	async function enable() {
		busy = true;
		try {
			await setAiMode('on');
			if (!aiKey()) await goto('/ajustes#gemini');
		} catch (e) {
			toast.error('No se pudo activar la IA', { detail: errMsg(e) });
		} finally {
			busy = false;
		}
	}
</script>

<div class="card stack">
	<h1>{aiMode() === 'off' ? 'La IA está desactivada' : 'Esta parte necesita la IA'}</h1>
	<p class="muted">
		Esta parte usa la IA (Gemini).
		{#if aiMode() === 'off'}Estás en <strong>modo sin IA</strong>:{:else}Aún no la activaste:{/if} el SRS, las lecciones, el
		diccionario, la biblioteca, la velocidad y los informes funcionan igual con el contenido ya preparado.
	</p>
	<div class="row">
		<button class="primary" onclick={enable} disabled={busy}>Activar la IA</button>
		<a class="btn" href="/">Volver a Inicio</a>
	</div>
</div>
