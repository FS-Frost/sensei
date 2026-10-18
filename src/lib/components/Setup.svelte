<script lang="ts">
	// Pantalla mientras el «servidor» del navegador no está listo: instalar el diccionario, progreso,
	// otra pestaña abierta o navegador sin soporte.
	import { backend, installDict } from '../client/backend.svelte.ts';
	import type { DictVariant } from '../backendProtocol.ts';
	import InstallCard from './InstallCard.svelte';

	const s = $derived(backend.value);
	const mb = (b: number) => `${(b / 1048576).toFixed(b > 10 * 1048576 ? 0 : 1)} MB`;
	let variant: DictVariant = $state('common');
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
	{:else if s.state === 'installing'}
		<div class="card stack">
			{#if s.phase === 'download'}
				<p>Descargando el diccionario… {mb(s.loaded)} de {mb(s.total)}</p>
				<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round((s.loaded / (s.total || 1)) * 100)}>
					<div style="width:{(s.loaded / (s.total || 1)) * 100}%"></div>
				</div>
			{:else if s.phase === 'install'}
				<p><span class="spinner"></span> Instalando…</p>
			{:else}
				<p><span class="spinner"></span> Restaurando tu progreso en el diccionario nuevo…</p>
			{/if}
			<p class="small dim">No cierres esta pestaña.</p>
		</div>
		<!-- Buen momento: mientras descarga. Instalar no interrumpe la descarga. -->
		<InstallCard />
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
	}
</style>
