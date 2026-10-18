<script lang="ts">
	// Pantalla mientras el «servidor» del navegador no está listo: instalar el diccionario, progreso,
	// otra pestaña abierta o navegador sin soporte.
	import { backend, installDict } from '../client/backend.svelte.ts';
	import type { DictVariant } from '../backendProtocol.ts';
	import InstallCard from './InstallCard.svelte';
	import { preloadCode } from '$app/navigation';

	const s = $derived(backend.value);
	const mb = (b: number) => `${(b / 1048576).toFixed(b > 10 * 1048576 ? 0 : 1)} MB`;
	let variant: DictVariant = $state('common');

	// Mientras se descarga el diccionario, bajar ya el código de las primeras pantallas (bienvenida, inicio): al terminar
	// de instalar no hay que esperar a la red y la bienvenida aparece enseguida.
	let preloaded = false;
	$effect(() => {
		if (preloaded || (s.state !== 'installing' && s.state !== 'needs-dict')) return;
		preloaded = true;
		// Kit 3 tipa las rutas y añade la base del sitio él mismo.
		for (const p of ['/', '/bienvenida'] as const) void preloadCode(p).catch(() => {});
	});

	/** Pasos de la primera instalación: descargar → instalar → preparar la primera pantalla (cargar la app y tus datos). */
	type StepState = 'done' | 'now' | 'todo';
	const steps = $derived.by((): { label: string; state: StepState }[] => {
		const phase = s.state === 'installing' ? s.phase : s.state === 'ready' ? 'ready' : null;
		const order = ['download', 'install', 'ready'];
		const idx = phase === 'restore' ? 1 : order.indexOf(phase ?? '');
		const at = (i: number): StepState => (idx > i ? 'done' : idx === i ? 'now' : 'todo');
		return [
			{ label: 'Descargar el diccionario', state: at(0) },
			{ label: phase === 'restore' ? 'Restaurar tu progreso' : 'Instalarlo en este navegador', state: at(1) },
			{ label: 'Preparar tu primera pantalla', state: at(2) }
		];
	});
</script>

<div class="setup">
	<h1><span class="jp">先生</span> Sensei</h1>

	{#if s.state === 'starting'}
		<p class="muted"><span class="spinner"></span> Abriendo tu base de datos…</p>
	{:else if s.state === 'needs-dict'}
		<div class="card stack">
			<h2>Primer paso: descargar el diccionario</h2>
			<p class="small muted">
				Sensei funciona entero en tu navegador. Necesita una base local con los kanji, sus componentes, el vocabulario y frases de
				ejemplo (KANJIDIC2, JMdict, Tatoeba). Se descarga una vez y se guarda en este navegador; tu progreso también se queda aquí.
			</p>
			{#if s.manifest}
				<div class="opts">
					{#each Object.entries(s.manifest.variants) as [v, b] (v)}
						<label class="opt" class:sel={variant === v}>
							<input type="radio" name="variant" value={v} bind:group={variant} />
							<span>
								<strong>{v === 'common' ? 'Palabras comunes (recomendado)' : 'JMdict completo'}</strong>
								<span class="small muted">
									{b!.kanji.toLocaleString('es')} kanji · {b!.vocab.toLocaleString('es')} palabras · {b!.sentences.toLocaleString('es')} frases ·
									descarga {mb(b!.gzBytes)}
								</span>
							</span>
						</label>
					{/each}
				</div>
				<div><button class="primary" onclick={() => installDict(variant)}>Descargar e instalar</button></div>
				<p class="small dim">Podrás cambiar de diccionario después en Ajustes sin perder tu progreso.</p>
			{:else}
				<p class="error small">
					No se encontró el diccionario publicado (<code>dict/manifest.json</code>). En local, genéralo con <code>bun run build:dict</code>.
				</p>
			{/if}
			{#if s.error}<p class="error small">{s.error}</p>{/if}
		</div>
		<InstallCard />
	{:else if s.state === 'installing' || s.state === 'ready'}
		<!-- «ready» aquí = base lista, pero la primera pantalla aún carga (código de la app y tus datos). -->
		<div class="card stack">
			<ol class="steps" aria-label="Progreso de la instalación">
				{#each steps as st (st.label)}
					<li class={st.state}>
						<span class="mark" aria-hidden="true">{#if st.state === 'done'}✓{:else if st.state === 'now'}<span class="spinner"></span>{:else}·{/if}</span>
						<span>{st.label}</span>
					</li>
				{/each}
			</ol>
			{#if s.state === 'installing' && s.phase === 'download'}
				<p class="small">{mb(s.loaded)} de {mb(s.total)}</p>
				<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round((s.loaded / (s.total || 1)) * 100)}>
					<div style="width:{(s.loaded / (s.total || 1)) * 100}%"></div>
				</div>
			{:else if s.state === 'ready'}
				<p class="small muted">Casi listo: cargando la app y tu primera pantalla…</p>
				<div class="bar indeterminate" role="progressbar" aria-label="Cargando"><div></div></div>
			{/if}
			<p class="small dim">No cierres esta pestaña.</p>
		</div>
		<!-- Buen momento: mientras descarga. Instalar no interrumpe la descarga. -->
		{#if s.state === 'installing'}<InstallCard />{/if}
	{:else if s.state === 'locked'}
		<div class="card stack">
			<h2>Sensei ya está abierto en otra pestaña</h2>
			<p class="small muted">Tu base de datos solo puede estar abierta en una pestaña a la vez. Ciérrala y recarga esta.</p>
			<div><button onclick={() => location.reload()}>Recargar</button></div>
		</div>
	{:else if s.state === 'unsupported'}
		<div class="card stack">
			<h2>Este navegador no puede guardar la base de datos</h2>
			<p class="small muted">
				Sensei necesita el almacenamiento privado de archivos (OPFS) con acceso síncrono. Usa una versión reciente de Chrome, Edge,
				Firefox o Safari, fuera del modo incógnito.
			</p>
			<p class="small dim">{s.error}</p>
		</div>
	{:else if s.state === 'error'}
		<div class="card stack">
			<h2>No se pudo abrir Sensei</h2>
			<p class="error small">{s.error}</p>
			<div><button onclick={() => location.reload()}>Reintentar</button></div>
		</div>
	{/if}
</div>

<style>
	.setup {
		max-width: 640px;
		margin: 3rem auto;
		padding: 0 1rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	h1 .jp {
		color: var(--accent);
	}
	.opts {
		display: grid;
		gap: 0.5rem;
	}
	.opt {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		margin: 0;
		color: var(--text);
		cursor: pointer;
	}
	.opt.sel {
		border-color: var(--accent);
	}
	.opt input {
		width: auto;
		margin-top: 0.25rem;
	}
	.opt span {
		display: flex;
		flex-direction: column;
	}
	.bar {
		height: 8px;
		border-radius: 999px;
		background: var(--bg-3);
		overflow: hidden;
	}
	.bar div {
		height: 100%;
		background: var(--series-1);
		transition: width 0.2s;
	}
	.bar.indeterminate div {
		width: 35%;
		border-radius: 999px;
		animation: slide 1.1s ease-in-out infinite;
	}
	@keyframes slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(290%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bar.indeterminate div {
			animation: none;
			width: 100%;
			opacity: 0.5;
		}
	}
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.45rem;
	}
	.steps li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.steps .mark {
		width: 1.3rem;
		text-align: center;
		flex: none;
	}
	.steps .done {
		color: var(--text-2);
	}
	.steps .done .mark {
		color: var(--ok);
		font-weight: 700;
	}
	.steps .now {
		font-weight: 600;
	}
	.steps .todo {
		color: var(--text-3);
	}
</style>
