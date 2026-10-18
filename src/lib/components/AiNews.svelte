<script lang="ts">
	// «Lo que añade la IA»: se abre al pasar de sin IA a con IA (client/ai.svelte.ts → aiNews), desde cualquier sitio.
	// Cada novedad lleva a donde se usa. Sin key, avisa de que hace falta para que funcione.
	import { aiKey, aiNews } from '../client/ai.svelte.ts';

	let dialog: HTMLDialogElement | undefined = $state();
	$effect(() => {
		if (!dialog) return;
		if (aiNews.open && !dialog.open) dialog.showModal();
		else if (!aiNews.open && dialog.open) dialog.close();
	});
	const close = () => (aiNews.open = false);

	const ITEMS = [
		{ icon: '話', title: 'Tutor', href: '/tutor', text: 'Conversación-quiz, quiz a medida, detective de confusiones y chat libre. Conoce tu progreso y recuerda las sesiones.' },
		{ icon: '💬', title: 'Panel 話 en toda la app', href: null, text: 'El botón flotante abre el tutor sabiendo qué estás viendo (una ficha, un repaso, un texto).' },
		{ icon: '読', title: 'Lecturas graduadas', href: '/lectura', text: 'Textos nuevos a tu nivel: casi todo lo que sabes y un poco nuevo (i+1), con preguntas.' },
		{ icon: '解', title: 'Explicador', href: '/explicar', text: 'Pega una frase o hazle una foto a un manga o cartel: lo transcribe y lo desglosa palabra por palabra.' },
		{ icon: '？', title: '«¿Por qué?» en los repasos', href: '/repaso', text: 'Al fallar, te explica en qué te equivocaste y cómo recordarlo.' },
		{ icon: '✨', title: 'Mnemotecnias nuevas', href: '/estadisticas#sanguijuelas', text: 'Para kanji que aún no traen la suya y otras a medida para los que se te resisten.' },
		{ icon: '⏩', title: 'Preparar por adelantado', href: '/datos', text: 'Genera ya el contenido de los próximos kanji que vas a estudiar.' },
		{ icon: '費', title: 'Costos', href: '/costos', text: 'Gasto estimado de cada llamada y un presupuesto mensual opcional.' }
	];
</script>

<dialog bind:this={dialog} class="card news" onclose={close}>
	<h2>Lo que añade la IA</h2>
	{#if !aiKey()}
		<p class="small warning">
			Para que funcione falta tu API key de Gemini: <a href="/ajustes#gemini" onclick={close}>pégala en Ajustes</a> (Google ofrece un uso
			gratuito limitado).
		</p>
	{/if}
	<ul>
		{#each ITEMS as it (it.title)}
			<li>
				<span class="ic jp" aria-hidden="true">{it.icon}</span>
				<span>
					{#if it.href}<a href={it.href} onclick={close}><strong>{it.title}</strong></a>{:else}<strong>{it.title}</strong>{/if}
					<span class="small muted block">{it.text}</span>
				</span>
			</li>
		{/each}
	</ul>
	<p class="small dim">Todo lo demás sigue igual. Puedes volver al modo sin IA cuando quieras en Ajustes → Inteligencia artificial.</p>
	<div class="row end"><button class="primary" onclick={close}>Entendido</button></div>
</dialog>

<style>
	.news {
		width: min(560px, calc(100vw - 2rem));
		max-height: calc(100dvh - 2rem);
		overflow-y: auto;
		color: var(--text);
	}
	.news::backdrop {
		background: rgb(0 0 0 / 0.5);
	}
	ul {
		list-style: none;
		margin: 0.6rem 0;
		padding: 0;
		display: grid;
		gap: 0.55rem;
	}
	li {
		display: flex;
		gap: 0.7rem;
		align-items: flex-start;
	}
	.ic {
		width: 1.8rem;
		text-align: center;
		font-size: 1.2rem;
		color: var(--accent-2);
		flex: none;
	}
	.block {
		display: block;
	}
	.end {
		justify-content: flex-end;
	}
</style>
