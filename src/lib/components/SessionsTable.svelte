<script lang="ts">
	import { del, errMsg } from '../client/api.ts';
	import { toast } from '../client/toast.svelte.ts';
	import type { ChatMode } from '../types.ts';
	import { MODE_LABEL } from '../tutorModes.ts';
	import { filterSessions, nextSort, sortSessions, type SessionListRow, type Sort, type SortKey } from '../sessionsTable.ts';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import { fmtUsd } from '../cost.ts';

	let { sessions: initial }: { sessions: SessionListRow[] } = $props();

	let rows: SessionListRow[] = $state([]);
	$effect.pre(() => {
		rows = [...initial];
	});
	let query = $state('');
	let mode: ChatMode | '' = $state('');
	let sort: Sort = $state(null);
	let editing: number | null = $state(null);
	let editValue = $state('');
	let toDelete: SessionListRow | null = $state(null);
	let deleteOpen = $state(false);

	const label = (m: ChatMode) => MODE_LABEL[m];
	const shown = $derived(sortSessions(filterSessions(rows, query, mode, label), sort, label));

	const COLS: { key: SortKey; label: string }[] = [
		{ key: 'title', label: 'Nombre' },
		{ key: 'mode', label: 'Tipo' },
		{ key: 'messages', label: 'Mensajes' },
		{ key: 'costUsd', label: 'Costo' },
		{ key: 'lastAt', label: 'Última actividad' },
		{ key: 'startedAt', label: 'Creada' }
	];
	const arrow = (key: SortKey) => (sort?.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
	const ariaSort = (key: SortKey) => (sort?.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
	const fmt = (t: number) => new Date(t).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });

	async function saveTitle(r: SessionListRow) {
		const t = editValue.trim();
		editing = null;
		if (!t || t === r.title) return;
		try {
			const res = await fetch(`/api/chat/${r.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: t })
			});
			if (!res.ok) throw new Error((await res.json()).error ?? 'Error');
			r.title = t;
			toast.success('Sesión renombrada', { duration: 2500 });
		} catch (e) {
			toast.error('No se pudo renombrar', { detail: errMsg(e) });
		}
	}

	async function confirmDelete() {
		if (!toDelete) return;
		try {
			await del(`/api/chat/${toDelete.id}`);
			rows = rows.filter((r) => r.id !== toDelete!.id);
			deleteOpen = false;
			toast.success('Sesión borrada', { detail: 'Su costo sigue contando en Costos.' });
		} catch (e) {
			toast.error('No se pudo borrar la sesión', { detail: errMsg(e) });
		}
	}
</script>

<div class="card wrap">
	<table>
		<thead>
			<tr>
				{#each COLS as c (c.key)}
					<th aria-sort={ariaSort(c.key)} class="c-{c.key}">
						<button class="sort" onclick={() => (sort = nextSort(sort, c.key))} title="Ordenar (ascendente, descendente, normal)"
							>{c.label}{arrow(c.key)}</button
						>
					</th>
				{/each}
				<th class="c-acts"></th>
			</tr>
			<tr class="filters">
				<th><input bind:value={query} placeholder="Buscar…" aria-label="Buscar por nombre" /></th>
				<th>
					<select bind:value={mode} aria-label="Filtrar por tipo">
						<option value="">Todos</option>
						{#each Object.entries(MODE_LABEL) as [m, l] (m)}<option value={m}>{l}</option>{/each}
					</select>
				</th>
				<th class="c-messages"></th>
				<th class="c-costUsd"></th>
				<th class="c-lastAt"></th>
				<th class="c-startedAt"></th>
				<th class="c-acts"></th>
			</tr>
		</thead>
		<tbody>
			{#each shown as r (r.id)}
				<tr>
					<td class="c-title">
						{#if editing === r.id}
							<!-- svelte-ignore a11y_autofocus -->
							<input
								bind:value={editValue}
								autofocus
								onblur={() => saveTitle(r)}
								onkeydown={(e) => {
									if (e.key === 'Enter') saveTitle(r);
									if (e.key === 'Escape') editing = null;
								}}
							/>
						{:else}
							<a href="/tutor/{r.id}">{r.title ?? MODE_LABEL[r.mode]}</a>
						{/if}
					</td>
					<td class="c-mode">{MODE_LABEL[r.mode]}</td>
					<td class="c-messages num">{r.messages}</td>
					<td class="c-costUsd num">{fmtUsd(r.costUsd)}</td>
					<td class="c-lastAt">{fmt(r.lastAt)}</td>
					<td class="c-startedAt dim">{fmt(r.startedAt)}</td>
					<td class="c-acts">
						<button
							class="ghost small"
							title="Renombrar"
							aria-label="Renombrar"
							onclick={() => {
								editing = r.id;
								editValue = r.title ?? '';
							}}>✎</button
						>
						<button
							class="ghost small"
							title="Borrar"
							aria-label="Borrar"
							onclick={() => {
								toDelete = r;
								deleteOpen = true;
							}}>🗑</button
						>
					</td>
				</tr>
			{:else}
				<tr><td colspan="7" class="muted small empty">{rows.length ? 'Ninguna sesión coincide con el filtro.' : 'Aún no hay sesiones.'}</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<ConfirmDialog bind:open={deleteOpen} title="Borrar sesión" confirmLabel="Borrar" onconfirm={confirmDelete}>
	<p>
		¿Borrar «{toDelete?.title}» y sus {toDelete?.messages} mensaje(s)? Su resumen deja de contar en la memoria del tutor.
	</p>
</ConfirmDialog>

<style>
	.wrap {
		padding: 0;
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-size: 0.92rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.45rem 0.6rem;
		border-bottom: 1px solid var(--line);
		vertical-align: middle;
	}
	th {
		font-weight: 500;
		color: var(--text-2);
		white-space: nowrap;
	}
	.sort {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
	.sort:hover {
		color: var(--text);
	}
	.filters th {
		padding-top: 0;
	}
	.filters input,
	.filters select {
		padding: 0.3rem 0.5rem;
		font-size: 0.85rem;
	}
	.c-title {
		min-width: 14rem;
	}
	.c-title input {
		padding: 0.25rem 0.4rem;
	}
	.num {
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
	.c-acts {
		white-space: nowrap;
		text-align: right;
	}
	tbody tr:hover {
		background: var(--bg-3);
	}
	.empty {
		text-align: center;
		padding: 1rem;
	}
	@media (max-width: 700px) {
		.c-startedAt,
		.c-messages,
		.c-costUsd {
			display: none;
		}
	}
	@media (max-width: 560px) {
		.c-lastAt {
			display: none;
		}
		.c-title {
			min-width: 0;
		}
	}
</style>
