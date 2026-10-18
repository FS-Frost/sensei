<script lang="ts">
	// Tutor en un panel lateral disponible en toda la app. Sabe qué estás viendo (chip de contexto quitable).
	import { page } from '$app/state';
	import { base } from '../../client/base.ts';
	import { get } from '../../client/api.ts';
	import { activeContext, dismissContext, tutor } from '../../client/tutorContext.svelte.ts';
	import type { ScreenContext } from '../../types.ts';
	import { SUGGEST } from '../../tutorModes.ts';
	import ChatView from './ChatView.svelte';

	let sid: number | null = $state(null);
	let loaded = $state(false);

	// Ruta sin la base del sitio (GitHub Pages: /<repo>/…).
	const path = $derived(page.url.pathname.slice(base.length) || '/');
	const hidden = $derived(path.startsWith('/tutor'));

	// Contexto genérico de la pantalla si la página no publica uno propio.
	const PAGE_NAMES: Record<string, string> = {
		'/': 'Inicio',
		'/repaso': 'Repaso',
		'/leccion': 'Lección',
		'/biblioteca': 'Biblioteca',
		'/lectura': 'Lectura graduada',
		'/explicar': 'Explicador',
		'/velocidad': 'Velocidad',
		'/informe': 'Informe semanal',
		'/kanji': 'Mapa de kanji',
		'/kana': 'Diagnóstico de kana',
		'/estadisticas': 'Estadísticas',
		'/guia': 'Guía',
		'/datos': 'Datos y copias',
		'/sincronizar': 'Sincronizar',
		'/compartir': 'Compartido con Sensei',
		'/ajustes': 'Ajustes',
		'/nivel': 'Test de nivel',
		'/bienvenida': 'Bienvenida'
	};
	const pageCtx = $derived.by((): ScreenContext | null => {
		const name = PAGE_NAMES[path];
		return name ? { kind: 'page', label: `pantalla ${name}`, data: { path } } : null;
	});
	const ctx = $derived(activeContext() ?? (pageCtx && pageCtx.label !== tutor.dismissed ? pageCtx : null));

	const suggestions = $derived.by(() => {
		const c = tutor.context;
		if (!c) return SUGGEST.libre;
		if (c.kind === 'kanji') return ['¿Cómo recuerdo este kanji?', '¿Con qué lo puedo confundir?', 'Ponlo en mi próxima lección'];
		if (c.kind === 'review') return ['¿Por qué fallé?', 'Dame otra forma de recordarlo', 'Hazme 3 preguntas parecidas'];
		if (c.kind === 'lesson') return ['Explícamelo de otra forma', 'Dame frases de ejemplo', '¿Con qué lo confundiré?'];
		if (c.kind === 'library') return ['¿Qué estudio antes de leer esto?', 'Explícame la primera frase', '¿Cuándo podré leerlo entero?'];
		if (c.kind === 'reading' || c.kind === 'explain') return ['Explícame la gramática', 'Guárdame las frases útiles', 'Hazme preguntas de comprensión'];
		if (c.kind === 'word') return ['Dame ejemplos con esta palabra', '¿Cómo se conjuga?', 'Ponla en mi próxima lección'];
		return SUGGEST.libre;
	});

	// Enlace directo: cualquier URL con ?tutor=1 abre el panel.
	$effect(() => {
		if (page.url.searchParams.has('tutor')) tutor.open = true;
	});

	$effect(() => {
		if (!tutor.open || loaded) return;
		loaded = true;
		get<{ session: { id: number } | null }>('/api/chat/panel')
			.then((r) => (sid = r.session?.id ?? null))
			.catch(() => (sid = null));
	});

	function clearCtx() {
		if (activeContext()) dismissContext();
		else tutor.dismissed = pageCtx?.label ?? null;
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && tutor.open && !(e.target as HTMLElement)?.closest?.('dialog')) tutor.open = false;
	}
</script>

<svelte:window {onkeydown} />

{#if !hidden}
	{#if !tutor.open}
		<button class="fab jp" onclick={() => (tutor.open = true)} title="Preguntar al tutor (sabe lo que estás viendo)" aria-label="Abrir tutor">話</button>
	{:else}
		<aside class="panel" aria-label="Tutor">
			<div class="head">
				<strong><span class="jp">話</span> Tutor</strong>
				<div class="row">
					<button class="small ghost" onclick={() => (sid = null)} title="Empezar una conversación nueva">Nueva</button>
					{#if sid}<a class="btn small ghost" href="/tutor/{sid}" title="Abrir en la página del tutor">Abrir en grande</a>{/if}
					<button class="small ghost" onclick={() => (tutor.open = false)} aria-label="Cerrar">✕</button>
				</div>
			</div>
			<ChatView
				sessionId={sid}
				mode="libre"
				origin="panel"
				compact
				context={ctx}
				bind:draft={tutor.draft}
				{suggestions}
				onsession={(id) => (sid = id)}
				onclearcontext={clearCtx}
			/>
		</aside>
	{/if}
{/if}

<style>
	.fab {
		position: fixed;
		right: 1.2rem;
		bottom: 1.2rem;
		z-index: 45;
		width: 3.2rem;
		height: 3.2rem;
		border-radius: 50%;
		font-size: 1.4rem;
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
		box-shadow: 0 6px 18px var(--shadow);
	}
	.panel {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		z-index: 45;
		width: min(420px, 100vw);
		background: var(--bg);
		border-left: 1px solid var(--line);
		box-shadow: -10px 0 30px var(--shadow);
		display: flex;
		flex-direction: column;
		padding: 0.7rem 0.8rem;
		gap: 0.5rem;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.4rem;
	}
	.head .jp {
		color: var(--accent);
	}
	@media (max-width: 760px) {
		.fab {
			bottom: 4.6rem;
			right: 0.9rem;
		}
		.panel {
			width: 100vw;
			bottom: 0;
			z-index: 50;
		}
	}
</style>
