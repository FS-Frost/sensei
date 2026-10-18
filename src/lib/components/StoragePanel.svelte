<script lang="ts">
	// Datos → Almacenamiento: cuánto ocupa Sensei en este navegador, si el navegador puede borrarlo y cómo liberar espacio.
	// La base y las copias las mide el Worker (/api/data/storage); la cuota y las cachés, esta página.
	import { onMount } from 'svelte';
	import { get, post, errMsg } from '../client/api.ts';
	import { toast } from '../client/toast.svelte.ts';
	import { install } from '../client/install.svelte.ts';

	let { onchange }: { onchange?: () => void } = $props();

	type Report = {
		db: { bytes: number; freePages: number; pages: number; freeRatio: number; tables: { name: string; bytes: number }[] };
		dict: { variant: string; version: string | null };
		backups: { count: number; bytes: number; newest: number | null };
	};
	type CacheRow = { name: string; label: string; bytes: number; entries: number };

	let report = $state<Report | null>(null);
	let usage = $state<number | null>(null);
	let quota = $state<number | null>(null);
	let persisted = $state<boolean | null>(null);
	let cachesInfo = $state<CacheRow[]>([]);
	let busy = $state('');
	let integrity = $state<{ ok: boolean; problems: string[] } | null>(null);

	const CACHE_LABELS: Record<string, string> = {
		'sensei-kanjivg': 'Trazos de kanji (KanjiVG)',
		'sensei-inbox': 'Compartido pendiente',
		'sensei-reminder': 'Recordatorio de repasos'
	};
	const cacheLabel = (n: string) => CACHE_LABELS[n] ?? (n.startsWith('sensei-') ? 'App sin conexión (esta versión)' : n);

	const fmt = (b: number) =>
		b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`;

	async function measureCaches() {
		if (typeof caches === 'undefined') return;
		const rows: CacheRow[] = [];
		for (const name of await caches.keys()) {
			const c = await caches.open(name);
			let bytes = 0;
			const reqs = await c.keys();
			for (const r of reqs) bytes += (await (await c.match(r))?.blob())?.size ?? 0;
			rows.push({ name, label: cacheLabel(name), bytes, entries: reqs.length });
		}
		cachesInfo = rows.sort((a, b) => b.bytes - a.bytes);
	}

	async function load() {
		try {
			const est = await navigator.storage?.estimate?.();
			usage = est?.usage ?? null;
			quota = est?.quota ?? null;
			persisted = (await navigator.storage?.persisted?.()) ?? null;
			report = await get<Report>('/api/data/storage');
			await measureCaches();
		} catch (e) {
			toast.error('No se pudo medir el almacenamiento', { detail: errMsg(e) });
		}
	}

	async function protect() {
		busy = 'persist';
		persisted = (await navigator.storage?.persist?.()) ?? false;
		if (persisted) toast.success('Datos protegidos', { detail: 'El navegador no los borrará para liberar espacio.' });
		else toast.warn('El navegador no concedió la protección', { detail: 'Suele concederla a apps instaladas o que se usan a menudo.' });
		busy = '';
	}

	async function action(a: 'integrity' | 'vacuum' | 'prune-backups') {
		busy = a;
		try {
			if (a === 'integrity') {
				integrity = await post('/api/data/storage', { action: a });
				if (integrity?.ok) toast.success('La base está bien');
			}
			if (a === 'vacuum') {
				const r = await post<{ before: number; after: number; backup: string }>('/api/data/storage', { action: a });
				toast.success(`Base compactada: ${fmt(r.before)} → ${fmt(r.after)}`, { detail: `Copia previa: ${r.backup}.` });
			}
			if (a === 'prune-backups') {
				const r = await post<{ removed: number; bytes: number }>('/api/data/storage', { action: a });
				if (r.removed) toast.success(`${r.removed} copias borradas (${fmt(r.bytes)} liberados)`, { detail: 'Se conservó la más reciente.' });
				else toast.info('Solo hay una copia: se conserva');
				onchange?.();
			}
			await load();
		} catch (e) {
			toast.error('La operación falló', { detail: errMsg(e) });
		} finally {
			busy = '';
		}
	}

	async function clearCache(name: string) {
		busy = name;
		await caches.delete(name);
		toast.success(`«${cacheLabel(name)}» vaciada`);
		busy = '';
		await load();
	}

	onMount(load);

	const pct = $derived(usage != null && quota ? Math.min(100, (usage / quota) * 100) : null);
</script>

<section class="card stack" id="almacenamiento">
	<h2>Almacenamiento</h2>

	{#if usage != null && quota}
		<div class="small">
			Sensei ocupa <strong>{fmt(usage)}</strong> de {fmt(quota)} disponibles para este sitio ({pct!.toFixed(pct! < 1 ? 2 : 0)} %).
		</div>
		<div class="bar" role="meter" aria-label="Espacio usado" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(pct ?? 0)}>
			<div style="width:{Math.max(1, pct ?? 0)}%" class:high={(pct ?? 0) > 80}></div>
		</div>
		{#if (pct ?? 0) > 80}<p class="small warn-text">Queda poco espacio: el navegador podría borrar datos del sitio. Descarga una copia.</p>{/if}
	{/if}

	{#if persisted === true}
		<p class="small ok-text">✓ Protegido: el navegador no borrará tus datos para liberar espacio.</p>
	{:else if persisted === false}
		<div class="row small">
			<span class="warn-text">⚠ No protegido: si falta espacio, el navegador puede borrar tus datos.</span>
			<button class="small" onclick={protect} disabled={busy === 'persist'}>Pedir protección</button>
		</div>
		{#if !install.installed}<p class="small dim">Instalar Sensei como app (Ajustes → App) ayuda a que el navegador lo conceda.</p>{/if}
	{/if}

	{#if report}
		<table class="small">
			<tbody>
				<tr>
					<td>Base de datos <span class="dim">(progreso + diccionario {report.dict.variant === 'full' ? 'completo' : 'común'})</span></td>
					<td class="num">{fmt(report.db.bytes)}</td>
					<td></td>
				</tr>
				<tr>
					<td>Copias de seguridad <span class="dim">({report.backups.count})</span></td>
					<td class="num">{fmt(report.backups.bytes)}</td>
					<td>
						{#if report.backups.count > 1}
							<button class="ghost small" onclick={() => action('prune-backups')} disabled={!!busy}>Dejar solo la más reciente</button>
						{/if}
					</td>
				</tr>
				{#each cachesInfo as c (c.name)}
					<tr>
						<td>{c.label} <span class="dim">({c.entries} archivos)</span></td>
						<td class="num">{fmt(c.bytes)}</td>
						<td>
							{#if c.name === 'sensei-kanjivg' && c.entries}
								<button class="ghost small" onclick={() => clearCache(c.name)} disabled={!!busy}>Vaciar</button>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		{#if report.db.tables.length}
			<details class="small">
				<summary>Tablas más grandes</summary>
				<ul class="tables">
					{#each report.db.tables as t (t.name)}<li><code>{t.name}</code> {fmt(t.bytes)}</li>{/each}
				</ul>
			</details>
		{/if}

		<div class="row">
			<button class="small" onclick={() => action('integrity')} disabled={!!busy}>
				{#if busy === 'integrity'}<span class="spinner"></span>{/if} Comprobar la base
			</button>
			<button
				class="small"
				onclick={() => action('vacuum')}
				disabled={!!busy || report.db.freeRatio < 0.02}
				title={report.db.freeRatio < 0.02 ? 'No hay espacio libre que recuperar' : ''}
			>
				{#if busy === 'vacuum'}<span class="spinner"></span>{/if} Compactar
				{#if report.db.freePages}({fmt(report.db.freePages * (report.db.bytes / Math.max(1, report.db.pages)))} libres){/if}
			</button>
		</div>
		{#if integrity}
			{#if integrity.ok}<p class="small ok-text">✓ La base está bien.</p>
			{:else}
				<div class="error small">
					La base tiene problemas: {integrity.problems.slice(0, 3).join(' · ')}. Restaura una copia de abajo o exporta lo que puedas.
				</div>
			{/if}
		{/if}
	{/if}
	<p class="small dim">Nada de esto toca tu progreso. Compactar crea antes una copia («Antes de compactar la base»).</p>
</section>

<style>
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
	.bar div.high {
		background: var(--warn);
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	td {
		padding: 0.3rem 0.4rem 0.3rem 0;
		border-bottom: 1px solid var(--line);
	}
	.num {
		text-align: right;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.tables {
		margin: 0.3rem 0 0;
		padding-left: 1.2rem;
	}
	.ok-text {
		color: var(--ok);
	}
	.warn-text {
		color: var(--warn);
	}
</style>
