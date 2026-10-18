<script lang="ts">
	// Llega algo compartido hacia Sensei (Share Target) o abierto con Sensei (File Handling): elegir qué hacer.
	// Si solo hay un destino posible, se va directo.
	import { onMount } from 'svelte';
	import { goto } from '#lib/client/nav.ts';
	import { onOpenedFiles, setPending, takeShared, type Incoming } from '#lib/client/inbox.ts';
	import { fileKind, hasJapanese, sharedText } from '#lib/client/pwa-core.ts';

	let incoming = $state<Incoming | null>(null);
	let loading = $state(true);
	let failed = $state(false);

	const text = $derived(incoming ? sharedText(incoming) : '');
	const images = $derived(incoming?.files.filter((f) => fileKind(f.name, f.type) === 'image') ?? []);
	const library = $derived(incoming?.files.filter((f) => fileKind(f.name, f.type) === 'library') ?? []);
	const backups = $derived(incoming?.files.filter((f) => fileKind(f.name, f.type) === 'backup') ?? []);
	const others = $derived(incoming?.files.filter((f) => fileKind(f.name, f.type) === 'other') ?? []);

	type Action = { label: string; hint: string; run: () => void };
	const actions = $derived.by(() => {
		const a: Action[] = [];
		if (!incoming) return a;
		if (images.length)
			a.push({
				label: '解 Explicar la imagen',
				hint: images.length > 1 ? `Se usa la primera de ${images.length}.` : 'Transcribe y desglosa el japonés de la foto.',
				run: () => go('explicar', { files: [images[0]] })
			});
		if (text)
			a.push({
				label: '解 Explicar el texto',
				hint: 'Desglose frase a frase con gramática.',
				run: () => go('explicar', { text, files: [] })
			});
		if (library.length || text)
			a.push({
				label: '書 Añadir a la Biblioteca',
				hint: library.length ? library.map((f) => f.name).join(', ') : 'Calcula cuánto entiendes y qué estudiar primero.',
				run: () => go('biblioteca', { files: library, text: library.length ? undefined : text, title: incoming?.title })
			});
		if (backups.length)
			a.push({
				label: '保 Importar datos (.zip)',
				hint: `${backups[0].name}: verás qué contiene antes de reemplazar nada.`,
				run: () => go('datos', { files: [backups[0]] })
			});
		return a;
	});

	function go(to: 'explicar' | 'biblioteca' | 'datos', p: { text?: string; title?: string; files: File[] }) {
		setPending({ to, ...p });
		void goto(`/${to}`);
	}

	function receive(x: Incoming | null) {
		loading = false;
		if (!x) return;
		incoming = x;
		// Un único destino posible: directo (salvo texto, que puede ir a dos sitios).
		if (actions.length === 1 && !text) actions[0].run();
	}

	onMount(() => {
		failed = new URLSearchParams(location.search).has('error');
		onOpenedFiles((files) => receive({ files }));
		takeShared()
			.then((x) => {
				if (x) receive(x);
				else loading = false;
			})
			.catch(() => (loading = false));
	});
</script>

<svelte:head><title>Compartido · Sensei</title></svelte:head>

<h1>Llegó a Sensei</h1>

{#if failed}
	<div class="error small">No se pudo recibir lo compartido. Prueba otra vez o súbelo desde la pantalla correspondiente.</div>
{/if}

{#if loading}
	<span class="spinner"></span>
{:else if !incoming}
	<div class="card stack">
		<p>No hay nada pendiente.</p>
		<p class="small muted">
			Desde otra app usa <strong>Compartir → Sensei</strong> con un texto japonés, una foto o un archivo .txt / .srt / .epub. En el PC
			también puedes abrir esos archivos (y las copias .zip) con Sensei. Funciona con la app instalada.
		</p>
	</div>
{:else}
	<div class="card stack">
		{#if incoming.title}<p><strong>{incoming.title}</strong></p>{/if}
		{#if text}<p class="jp shared">{text.length > 400 ? text.slice(0, 400) + '…' : text}</p>{/if}
		{#if text && !hasJapanese(text)}<p class="small warn-text">No veo japonés en el texto: ¿seguro que es lo que querías compartir?</p>{/if}
		{#if incoming.url && !text && !incoming.files.length}
			<p class="small">
				Llegó solo un enlace (<code>{incoming.url}</code>). Sensei no puede descargar páginas web: abre la página, selecciona el texto
				japonés y compártelo.
			</p>
		{/if}
		{#if incoming.files.length}
			<ul class="small files">
				{#each incoming.files as f (f.name)}<li>{f.name} <span class="dim">({Math.ceil(f.size / 1024)} KB)</span></li>{/each}
			</ul>
		{/if}
		{#if others.length}<p class="small warn-text">No sé qué hacer con: {others.map((f) => f.name).join(', ')}.</p>{/if}
	</div>

	{#if actions.length}
		<h2>¿Qué hago con esto?</h2>
		<div class="actions">
			{#each actions as a (a.label)}
				<button class="big" onclick={a.run}><strong class="jp">{a.label}</strong><span class="small">{a.hint}</span></button>
			{/each}
		</div>
	{/if}
{/if}

<style>
	.shared {
		white-space: pre-wrap;
		margin: 0;
		font-size: 1.1rem;
	}
	.files {
		margin: 0;
		padding-left: 1.2rem;
	}
	.actions {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.6rem;
	}
	.big {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.2rem;
		padding: 0.9rem 1rem;
		text-align: left;
	}
	.warn-text {
		color: var(--warn);
	}
</style>
