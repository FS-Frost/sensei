<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '#lib/client/nav.ts';
	import { del, get, errMsg, ApiError } from '#lib/client/api.ts';
	import HelpLink from '#lib/components/HelpLink.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import { takePending } from '#lib/client/inbox.ts';
	import { toast } from '#lib/client/toast.svelte.ts';

	type Item = {
		id: number;
		title: string;
		origin: string;
		createdAt: number;
		chars: number;
		reads: number;
		lastCpm: number | null;
		nextReread: number | null;
	};

	let texts: Item[] = $state([]);
	let title = $state('');
	let text = $state('');
	let fileInput: HTMLInputElement | undefined = $state();
	let busy = $state(false);
	let error = $state('');
	let toDelete: Item | null = $state(null);
	let deleteOpen = $state(false);

	async function load() {
		texts = (await get<{ texts: Item[] }>('/api/library')).texts;
	}

	async function upload(file?: File, open = true) {
		busy = true;
		error = '';
		try {
			const fd = new FormData();
			fd.append('title', title);
			if (file) fd.append('file', file);
			else fd.append('text', text);
			const res = await fetch('/api/library', { method: 'POST', body: fd });
			const data = await res.json();
			if (!res.ok) throw new ApiError(res.status, data.error ?? 'Error');
			title = '';
			text = '';
			if (open && data.ids.length === 1) goto(`/biblioteca/${data.ids[0]}`);
			else {
				await load();
				toast.success(data.ids.length > 1 ? `${data.ids.length} partes añadidas a la Biblioteca` : 'Texto añadido a la Biblioteca', {
					detail: file ? file.name : undefined
				});
			}
		} catch (e) {
			error = errMsg(e);
			toast.error(file ? `No se pudo añadir «${file.name}»` : 'No se pudo añadir el texto', { detail: error });
		} finally {
			busy = false;
		}
	}

	async function confirmDelete() {
		if (!toDelete) return;
		await del(`/api/library/${toDelete.id}`);
		deleteOpen = false;
		toast.success(`«${toDelete.title}» borrado`);
		await load();
	}

	const ORIGIN: Record<string, string> = { paste: 'pegado', txt: '.txt', srt: 'subtítulos', epub: 'EPUB', html: 'web' };
	onMount(() => {
		load().catch((e) => toast.error('No se pudo cargar la biblioteca', { detail: errMsg(e) }));
		// Llegó compartido o abierto con Sensei (/compartir): archivos se suben solos; un texto queda listo para añadir.
		const p = takePending('biblioteca');
		if (!p) return;
		if (p.files.length) void uploadAll(p.files);
		else if (p.text) {
			text = p.text;
			title = p.title ?? '';
		}
	});

	async function uploadAll(files: File[]) {
		for (const f of files) {
			await upload(f, files.length === 1);
			if (error) return;
		}
	}
</script>

<svelte:head><title>Biblioteca · Sensei</title></svelte:head>

<h1>Biblioteca <HelpLink section="biblioteca" /></h1>
<p class="muted small">
	Trae lo que <strong>quieres</strong> leer: un capítulo de web novel, subtítulos de un anime, un EPUB, el texto de un juego. Sensei calcula
	cuánto entiendes ya, te propone qué estudiar primero y lo pone a la cabeza de tus lecciones. Luego lo lees (y relees) cronometrando.
</p>

<div class="card stack">
	<h2>Añadir texto</h2>
	<input bind:value={title} placeholder="Título (opcional)" />
	<textarea bind:value={text} rows="5" class="jp" placeholder="Pega aquí el texto japonés…"></textarea>
	<div class="row">
		<button class="primary" onclick={() => upload()} disabled={busy || !text.trim()}>
			{#if busy}<span class="spinner"></span>{/if} Añadir y analizar
		</button>
		<span class="muted small">o</span>
		<input
			type="file"
			accept=".txt,.srt,.epub,.html,.htm,text/plain"
			bind:this={fileInput}
			hidden
			onchange={(e) => {
				const f = (e.target as HTMLInputElement).files?.[0];
				(e.target as HTMLInputElement).value = '';
				if (f) upload(f);
			}}
		/>
		<button onclick={() => fileInput?.click()} disabled={busy}>Subir .txt / .srt / .epub</button>
	</div>
	<p class="dim small">Los EPUB se dividen por capítulos. La furigana del original se quita: Sensei pone la tuya según tu nivel.</p>
</div>

{#if texts.length}
	<div class="card list">
		{#each texts as t (t.id)}
			<div class="item">
				<a href="/biblioteca/{t.id}" class="title">{t.title}</a>
				<span class="small muted">
					{ORIGIN[t.origin] ?? t.origin} · {t.chars} car.
					{#if t.reads}· {t.reads} lectura(s), {Math.round(t.lastCpm ?? 0)} car/min{/if}
					{#if t.nextReread}
						· {t.nextReread <= Date.now() ? '🔁 toca releer' : `releer el ${new Date(t.nextReread).toLocaleDateString('es')}`}
					{/if}
				</span>
				<button
					class="ghost small"
					onclick={() => {
						toDelete = t;
						deleteOpen = true;
					}}>🗑</button
				>
			</div>
		{/each}
	</div>
{:else}
	<p class="muted small">Aún no hay textos.</p>
{/if}

<ConfirmDialog bind:open={deleteOpen} title="Borrar texto" confirmLabel="Borrar" onconfirm={confirmDelete}>
	<p>¿Borrar «{toDelete?.title}» y su historial de lecturas? Las palabras que ya estudiaste no se tocan.</p>
</ConfirmDialog>

<style>
	.list {
		padding: 0.3rem 0;
	}
	.item {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.1rem 0.8rem;
		padding: 0.55rem 1.1rem;
		border-bottom: 1px solid var(--line);
	}
	.item:last-child {
		border-bottom: none;
	}
	.title {
		font-weight: 600;
	}
	.item .small {
		grid-column: 1;
	}
	.item button {
		grid-row: 1 / span 2;
		grid-column: 2;
		align-self: center;
	}
</style>
