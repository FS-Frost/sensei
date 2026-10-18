<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';
	import { setPrefs } from '#lib/client/state.svelte.ts';
	import DictPopover from '#lib/components/DictPopover.svelte';
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';
	import { onMount } from 'svelte';
	import { onNavigate } from '$app/navigation';
	import { initTheme } from '#lib/client/theme.svelte.ts';
	import TutorPanel from '#lib/components/chat/TutorPanel.svelte';
	import Setup from '#lib/components/Setup.svelte';
	import { setScreenContext } from '#lib/client/tutorContext.svelte.ts';
	import { backend, startBackend, whenBecomesReady, installDict } from '#lib/client/backend.svelte.ts';
	import { startBaseLinks } from '#lib/client/basePath.ts';
	import { registerServiceWorker } from '#lib/client/pwa.ts';
	import UpdateNotice from '#lib/components/UpdateNotice.svelte';
	import { initInstall, install, promptInstall } from '#lib/client/install.svelte.ts';
	import { publishSchedule, setBadge } from '#lib/client/reminder.ts';

	// Temprano: `beforeinstallprompt` puede llegar antes de montar.
	initInstall();
	import { refreshAll } from '$app/navigation';
	import { base } from '#lib/client/base.ts';

	let { data, children }: LayoutProps = $props();

	startBackend();
	// Al quedar lista la base (primera instalación o actualización), recargar los datos de la página.
	whenBecomesReady(() => void refreshAll());
	const ready = $derived(backend.value.state === 'ready');
	const update = $derived(backend.value.state === 'ready' ? backend.value.update : null);
	let updateDismissed = $state(false);

	onMount(() => {
		initTheme();
		void registerServiceWorker();
		return startBaseLinks();
	});
	// Al cambiar de pantalla, el contexto anterior deja de valer; la nueva página publica el suyo.
	onNavigate(() => setScreenContext(null));

	// Repasos pendientes: número en el icono de la app y vencimientos para el recordatorio del service worker.
	let scheduleTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		if (!ready || data.due === undefined) return;
		setBadge(data.due);
		clearTimeout(scheduleTimer);
		scheduleTimer = setTimeout(() => void publishSchedule(), 2000);
	});

	$effect.pre(() => {
		if (ready && data.readable !== undefined)
			setPrefs({ furigana: data.furigana, ttsEnabled: data.ttsEnabled, fontVariety: data.fontVariety, readable: data.readable });
	});

	type NavItem = { href: string; label: string; icon: string; main: boolean };
	const GROUPS: { title: string; items: NavItem[] }[] = [
		{
			title: 'Estudiar',
			items: [
				{ href: '/', label: 'Inicio', icon: '家', main: true },
				{ href: '/repaso', label: 'Repaso', icon: '復', main: true },
				{ href: '/leccion', label: 'Lección', icon: '学', main: true },
				{ href: '/tutor', label: 'Tutor', icon: '話', main: true },
				{ href: '/kana', label: 'Kana', icon: 'あ', main: false }
			]
		},
		{
			title: 'Leer',
			items: [
				{ href: '/biblioteca', label: 'Biblioteca', icon: '書', main: false },
				{ href: '/lectura', label: 'Lectura graduada', icon: '読', main: false },
				{ href: '/explicar', label: 'Explicador', icon: '解', main: false },
				{ href: '/velocidad', label: 'Velocidad', icon: '速', main: false }
			]
		},
		{
			title: 'Progreso',
			items: [
				{ href: '/kanji', label: 'Kanji', icon: '字', main: false },
				{ href: '/estadisticas', label: 'Estadísticas', icon: '計', main: false },
				{ href: '/informe', label: 'Informe semanal', icon: '週', main: false }
			]
		},
		{
			title: 'Sistema',
			items: [
				{ href: '/guia', label: 'Guía', icon: '導', main: false },
				{ href: '/costos', label: 'Costos', icon: '費', main: false },
				{ href: '/sincronizar', label: 'Sincronizar', icon: '同', main: false },
				{ href: '/datos', label: 'Datos y copias', icon: '保', main: false },
				{ href: '/ajustes', label: 'Ajustes', icon: '設', main: false }
			]
		}
	];
	const NAV = GROUPS.flatMap((g) => g.items);

	let moreOpen = $state(false);
	// Ruta sin la base del sitio (GitHub Pages: /<repo>/…).
	const path = $derived(page.url.pathname.slice(base.length) || '/');
	const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
</script>

<svelte:head>
	{#if ready && data.fontVariety}
		<!-- Fuentes variadas para los repasos (si no hay conexión se usan equivalentes locales). -->
		<link rel="preconnect" href="https://fonts.googleapis.com" />
		<link
			rel="stylesheet"
			href="https://fonts.googleapis.com/css2?family=Klee+One&family=Shippori+Mincho&family=Zen+Maru+Gothic&family=Yuji+Syuku&family=Dela+Gothic+One&display=swap"
		/>
	{/if}
</svelte:head>

{#if path.startsWith('/lab/')}
	<!-- Laboratorio: páginas de prueba que no necesitan la base ni el diccionario. -->
	{@render children()}
{:else if !ready || data.readable === undefined}
	<Setup />
{:else}
	<div class="shell">
		<nav class="side" aria-label="Navegación">
			<a class="brand" href="/"><span class="jp">先生</span> Sensei</a>
			<div class="side-scroll">
				{#each GROUPS as g (g.title)}
					<div class="group">{g.title}</div>
					{#each g.items as n (n.href)}
						<a class="nav" class:active={active(n.href)} href={n.href}>
							<span class="icon jp">{n.icon}</span>{n.label}
							{#if n.href === '/repaso' && data.due}<span class="count">{data.due}</span>{/if}
						</a>
					{/each}
				{/each}
			</div>
			<div class="side-foot">
				{#if install.available}<button class="install" onclick={() => promptInstall()}>⤓ Instalar app</button>{/if}
				<ThemeToggle />
			</div>
		</nav>

		<main>
			{#if update && !updateDismissed}
				<div class="warning row">
					<span>Hay un diccionario nuevo publicado. Actualizarlo conserva tu progreso (antes se guarda una copia).</span>
					<button class="small" onclick={() => installDict(backend.value.state === 'ready' ? backend.value.dict.variant : 'common')}>
						Actualizar
					</button>
					<button class="small ghost" onclick={() => (updateDismissed = true)}>Más tarde</button>
				</div>
			{/if}
			{#if !data.gemini}
				<div class="warning">
					Sin API key de Gemini: el tutor, las lecturas, el explicador y las mnemotecnias no estarán disponibles.
					<a href="/ajustes#gemini">Añádela en Ajustes</a>.
				</div>
			{/if}
			{@render children()}
		</main>

		<nav class="bottom" aria-label="Navegación móvil">
			{#each NAV.filter((n) => n.main) as n (n.href)}
				<a class="tab" class:active={active(n.href)} href={n.href} onclick={() => (moreOpen = false)}>
					<span class="icon jp">{n.icon}</span>
					<span>{n.label}</span>
					{#if n.href === '/repaso' && data.due}<span class="count">{data.due}</span>{/if}
				</a>
			{/each}
			<button class="tab" class:active={moreOpen} onclick={() => (moreOpen = !moreOpen)}>
				<span class="icon jp">他</span><span>Más</span>
			</button>
		</nav>
		{#if moreOpen}
			<div class="more card">
				{#each GROUPS as g (g.title)}
					{@const rest = g.items.filter((n) => !n.main)}
					{#if rest.length}
						<div class="group">{g.title}</div>
						{#each rest as n (n.href)}
							<a class="nav" class:active={active(n.href)} href={n.href} onclick={() => (moreOpen = false)}>
								<span class="icon jp">{n.icon}</span>{n.label}
							</a>
						{/each}
					{/if}
				{/each}
				{#if install.available}
					<button
						class="install"
						onclick={() => {
							moreOpen = false;
							void promptInstall();
						}}>⤓ Instalar app</button
					>
				{/if}
				<ThemeToggle />
			</div>
		{/if}
	</div>
	<DictPopover />
	<TutorPanel />
{/if}
<UpdateNotice />

<style>
	.shell {
		display: grid;
		grid-template-columns: 220px 1fr;
		min-height: 100vh;
	}
	.side {
		position: sticky;
		top: 0;
		height: 100vh;
		padding: 1rem 0.8rem 0.6rem;
		border-right: 1px solid var(--line);
		background: var(--bg-2);
		display: flex;
		flex-direction: column;
	}
	/* La lista de enlaces tiene su propio scroll: marca arriba y tema abajo siempre visibles. */
	.side-scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
		scrollbar-width: thin;
	}
	.group {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-3);
		padding: 0.7rem 0.6rem 0.2rem;
	}
	.group:first-child {
		padding-top: 0;
	}
	.side-foot {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--line);
		padding-top: 0.4rem;
		margin-top: 0.4rem;
	}
	.more :global(.theme),
	.more .install {
		width: 100%;
	}
	.install {
		margin-bottom: 0.3rem;
		color: var(--accent);
	}
	.brand {
		font-weight: 700;
		font-size: 1.15rem;
		color: var(--text);
		padding: 0 0.6rem 0.6rem;
	}
	.brand .jp {
		color: var(--accent);
	}
	.nav {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.38rem 0.6rem;
		border-radius: var(--radius-sm);
		color: var(--text-2);
	}
	.nav:hover {
		background: var(--bg-3);
		text-decoration: none;
		color: var(--text);
	}
	.nav.active {
		background: var(--bg-3);
		color: var(--text);
	}
	.icon {
		width: 1.6rem;
		text-align: center;
		color: var(--accent-2);
	}
	.count {
		margin-left: auto;
		background: var(--accent);
		color: #fff;
		font-size: 0.75rem;
		border-radius: 999px;
		padding: 0 0.45rem;
	}
	main {
		padding: 1.5rem clamp(1rem, 3vw, 2.5rem) 3rem;
		max-width: 1100px;
		width: 100%;
		/* Sin esto, un hijo ancho (tabla, texto largo) ensancha la columna de la grid y la página entera en móvil. */
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.bottom,
	.more {
		display: none;
	}
	@media (max-width: 760px) {
		.shell {
			grid-template-columns: minmax(0, 1fr);
		}
		.side {
			display: none;
		}
		main {
			padding: 1rem 0.9rem 5.5rem;
		}
		.bottom {
			display: flex;
			position: fixed;
			bottom: 0;
			left: 0;
			right: 0;
			z-index: 40;
			background: var(--bg-2);
			border-top: 1px solid var(--line);
			padding-bottom: env(safe-area-inset-bottom);
		}
		.tab {
			flex: 1;
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 0;
			padding: 0.45rem 0 0.35rem;
			font-size: 0.72rem;
			color: var(--text-2);
			background: none;
			border: none;
			border-radius: 0;
			position: relative;
		}
		.tab .icon {
			font-size: 1.2rem;
		}
		.tab.active {
			color: var(--text);
		}
		.tab .count {
			position: absolute;
			top: 0.2rem;
			right: 18%;
		}
		.more {
			display: block;
			position: fixed;
			bottom: 4.2rem;
			right: 0.6rem;
			z-index: 41;
			min-width: 220px;
			padding: 0.4rem;
			max-height: calc(100vh - 5.5rem);
			overflow-y: auto;
		}
	}
</style>
