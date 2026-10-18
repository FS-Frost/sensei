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
			<strong>Sensei no incluye IA.</strong> Para usarla necesitas tu propia API key de Google Gemini (se crea en Google AI
			Studio). Google ofrece un uso gratuito limitado; por encima, lo cobra a tu cuenta según su plan, y Sensei te muestra el
			gasto estimado. Con ella: tutor, lecturas
			graduadas a tu nivel, explicador de textos y fotos, «¿Por qué?» en los repasos y mnemotecnias para los kanji que aún no
			traen.
		</p>
		<p class="small muted">
			Sin IA: SRS, kana, lecciones, diccionario, biblioteca, velocidad e informes funcionan igual, con el contenido ya preparado.
			Puedes cambiarlo cuando quieras en Ajustes.
		</p>
	</div>
	<!-- Sin IA primero y destacada (es lo que funciona sin configurar nada); nada queda marcado: es una pregunta. -->
	<div class="row">
		<button class="primary" onclick={() => choose('off')} disabled={busy}>Seguir sin IA</button>
		<button onclick={() => choose('on')} disabled={busy}>Usar IA (tengo o crearé una API key)</button>
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
	.ai-choice button {
		flex: 1;
		min-width: 200px;
	}
</style>
