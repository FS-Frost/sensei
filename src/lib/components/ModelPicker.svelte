<script lang="ts">
	// Selector de modelo de Gemini para un rol (Pro / Flash): precio, límites, razonamiento,
	// estimación con tu uso real y relación frente al modelo actual.
	import { get, errMsg } from '../client/api.ts';
	import { fmtPrice, fmtTokens, fmtUsd } from '../cost.ts';
	import { fold } from '../sessionsTable.ts';

	type Role = 'pro' | 'flash';
	type Tier = { from: string; input: number; cached: number; output: number; long?: { input: number; cached: number; output: number } };
	type Row = {
		id: string;
		displayName: string;
		description: string;
		inputLimit: number | null;
		outputLimit: number | null;
		thinking: boolean | null;
		compatible: boolean;
		price: { key: string; now: Tier | null; next: Tier | null } | null;
		roles: Record<Role, { usd: number | null; estimate: number | null }>;
	};
	type Data = {
		models: Row[];
		current: Record<Role, string>;
		env: Record<Role, string>;
		days: number;
		usageCalls: Record<Role, number>;
	};

	let {
		open = $bindable(false),
		role,
		value,
		onpick
	}: {
		open?: boolean;
		role: Role;
		/** Valor del formulario ('' = el de por defecto). */
		value: string;
		onpick: (id: string) => void;
	} = $props();

	const ROLE_LABEL: Record<Role, string> = { pro: 'Pro', flash: 'Flash' };
	const ROLE_USE: Record<Role, string> = {
		pro: 'tutor, lecturas graduadas, explicador (texto y fotos) y mnemotecnias',
		flash: 'resúmenes, informe semanal, «¿Por qué?», traducciones, nombres de componentes y kanji parecidos'
	};

	let dialog: HTMLDialogElement | undefined = $state();
	let data = $state<Data | null>(null);
	let error = $state('');
	let loading = $state(false);
	let query = $state('');
	let showAll = $state(false);
	let sort: 'cost' | 'name' | 'context' = $state('cost');

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			query = '';
			if (!data) load();
		} else if (!open && dialog.open) dialog.close();
	});

	async function load() {
		loading = true;
		error = '';
		try {
			data = await get<Data>('/api/models');
		} catch (e) {
			error = errMsg(e);
		} finally {
			loading = false;
		}
	}

	/** Modelo en uso para el rol según el formulario (vacío = el de por defecto). */
	const selected = $derived(value.trim() || data?.env[role] || '');
	const selectedRow = $derived(data?.models.find((m) => m.id === selected) ?? null);
	/** Costo del modelo elegido en el formulario: base de «Relativo». */
	const baseUsd = $derived(selectedRow?.roles[role].usd ?? null);
	const ratio = (r: Row) => {
		const u = r.roles[role].usd;
		return u != null && baseUsd ? u / baseUsd : null;
	};
	const costKey = (r: Row) => r.roles[role].usd ?? Number.POSITIVE_INFINITY;
	const rows = $derived.by(() => {
		if (!data) return [];
		const q = fold(query.trim());
		const out = data.models.filter(
			(m) => (showAll || m.compatible || m.id === selected) && (!q || fold(`${m.id} ${m.displayName} ${m.description}`).includes(q))
		);
		return out.sort((a, b) => {
			if (a.id === selected) return -1;
			if (b.id === selected) return 1;
			if (sort === 'name') return a.id.localeCompare(b.id);
			if (sort === 'context') return (b.inputLimit ?? 0) - (a.inputLimit ?? 0);
			return costKey(a) - costKey(b) || a.id.localeCompare(b.id);
		});
	});
	const hidden = $derived(data ? data.models.filter((m) => !m.compatible).length : 0);

	const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
	const fmtRatio = (x: number) => (x >= 10 ? `×${x.toFixed(0)}` : `×${x.toFixed(x < 1 ? 2 : 1)}`);

	function pick(id: string) {
		onpick(id);
		open = false;
	}
</script>

<dialog bind:this={dialog} onclose={() => (open = false)} class="card" aria-labelledby="mp-title">
	<div class="spread head">
		<h2 id="mp-title">Elegir modelo {ROLE_LABEL[role]}</h2>
		<button class="ghost small" onclick={() => (open = false)} aria-label="Cerrar">✕</button>
	</div>
	<p class="small muted">Se usa para {ROLE_USE[role]}.</p>

	{#if data}
		<p class="small">
			{#if data.usageCalls[role]}
				Tu uso de los últimos {data.days} días en este rol: {data.usageCalls[role]} {data.usageCalls[role] === 1 ? 'llamada' : 'llamadas'}{#if selectedRow?.roles[role].estimate != null},
					≈ <strong>{fmtUsd(selectedRow.roles[role].estimate)}</strong> con <code>{selected}</code> a precios de hoy{/if}. «Estimación» repite
				esos mismos tokens con cada modelo; «Relativo» lo compara con <code>{selected}</code>.
			{:else}
				Aún no hay uso en este rol: «Relativo» compara con <code>{selected}</code> en una conversación típica (90 % entrada, 10 % salida).
			{/if}
		</p>
	{/if}

	<div class="row tools">
		<input class="grow" bind:value={query} placeholder="Buscar modelo…" aria-label="Buscar modelo" />
		<label class="inline small">
			Orden
			<select bind:value={sort}>
				<option value="cost">Más barato primero</option>
				<option value="context">Más contexto</option>
				<option value="name">Nombre</option>
			</select>
		</label>
		{#if hidden}
			<label class="inline small"><input type="checkbox" bind:checked={showAll} /> Ver todos (+{hidden} no compatibles)</label>
		{/if}
	</div>

	{#if error}<div class="error small">{error}</div>{/if}
	{#if loading}<p class="small muted"><span class="spinner"></span> Cargando modelos…</p>{/if}

	{#if data}
		<div class="scroll">
			<table class="small">
				<thead>
					<tr>
						<th>Modelo</th>
						<th class="num">Entrada<br /><span class="dim">/1M</span></th>
						<th class="num">Salida<br /><span class="dim">/1M</span></th>
						<th class="num c-ctx">Contexto</th>
						<th class="c-think">Razona</th>
						<th class="num">Estimación<br /><span class="dim">{data.days} días</span></th>
						<th class="num">Relativo</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each rows as m (m.id)}
						{@const r = m.roles[role]}
						{@const now = m.price?.now}
						<tr class:sel={m.id === selected} class:incompatible={!m.compatible}>
							<td class="c-model">
								<div>
									<strong>{m.displayName}</strong>
									{#if m.id === selected}<span class="badge">en uso</span>{/if}
									{#if m.id === data.env[role]}<span class="badge">por defecto</span>{/if}
									{#if !m.compatible}<span class="badge">no compatible</span>{/if}
								</div>
								<code class="dim">{m.id}</code>
								{#if m.description && m.description !== m.displayName}<div class="desc dim" title={m.description}>{m.description}</div>{/if}
							</td>
							{#if now}
								<td class="num" title="Caché: {fmtPrice(now.cached)}/1M">{fmtPrice(now.input)}</td>
								<td class="num">{fmtPrice(now.output)}</td>
							{:else}
								<td class="num dim" colspan="2">sin precio · <a href="/costos" onclick={() => (open = false)}>añadir</a></td>
							{/if}
							<td class="num c-ctx">{m.inputLimit ? fmtTokens(m.inputLimit) : '—'}</td>
							<td class="c-think">{m.thinking == null ? '—' : m.thinking ? 'sí' : 'no'}</td>
							<td class="num">{r.estimate != null ? `≈ ${fmtUsd(r.estimate)}` : '—'}</td>
							<td class="num">{m.id === selected ? '×1' : ratio(m) != null ? fmtRatio(ratio(m)!) : '—'}</td>
							<td class="act">
								{#if m.id === selected}
									<span class="dim">✓</span>
								{:else}
									<button class="small" onclick={() => pick(m.id)}>Elegir</button>
								{/if}
							</td>
						</tr>
						{#if m.price?.next || now?.long}
							<tr class="note" class:sel={m.id === selected}>
								<td colspan="8" class="dim">
									{#if m.price?.next}Desde el {fmtDate(m.price.next.from)}: {fmtPrice(m.price.next.input)} entrada / {fmtPrice(m.price.next.output)} salida.{/if}
									{#if now?.long}Prompts de más de 200k tokens: {fmtPrice(now.long.input)} / {fmtPrice(now.long.output)}.{/if}
								</td>
							</tr>
						{/if}
					{:else}
						<tr><td colspan="8" class="muted">Ningún modelo coincide.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="small dim">
			Precios en USD por 1 M de tokens (salida incluye el razonamiento); edítalos en <a href="/costos" onclick={() => (open = false)}>Costos</a>. La estimación supone los
			mismos tokens: un modelo que razona más gastará más salida. «No compatible» = voz, imagen, vídeo, embeddings, live o agentes.
		</p>
	{/if}
	<div class="row actions">
		{#if value.trim()}<button class="ghost" onclick={() => pick('')}>Usar el de por defecto ({data?.env[role] ?? '…'})</button>{/if}
		<button onclick={() => (open = false)}>Cerrar</button>
	</div>
</dialog>

<style>
	dialog {
		width: min(1000px, calc(100vw - 1rem));
		max-height: calc(100vh - 2rem);
		color: var(--text);
		padding: 1rem 1.2rem;
		display: none;
		flex-direction: column;
		gap: 0.5rem;
	}
	dialog[open] {
		display: flex;
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.5);
	}
	h2 {
		margin: 0;
	}
	p {
		margin: 0;
	}
	.tools {
		align-items: center;
	}
	.grow {
		flex: 1;
		min-width: 12rem;
	}
	.inline {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0;
		color: var(--text-2);
	}
	.inline input {
		width: auto;
	}
	.inline select {
		width: auto;
		padding: 0.3rem 0.5rem;
	}
	.scroll {
		overflow: auto;
		min-height: 0;
		flex: 1;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
	}
	table {
		border-collapse: collapse;
		width: 100%;
	}
	th,
	td {
		text-align: left;
		padding: 0.4rem 0.5rem;
		border-bottom: 1px solid var(--line);
		vertical-align: top;
	}
	thead th {
		position: sticky;
		top: 0;
		background: var(--bg-2);
		color: var(--text-2);
		font-weight: 500;
		z-index: 1;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.c-model {
		min-width: 15rem;
	}
	.c-model code {
		font-size: 0.8rem;
	}
	.desc {
		font-size: 0.78rem;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		max-width: 30rem;
	}
	.badge {
		margin-left: 0.3rem;
	}
	tr.sel td {
		background: var(--bg-3);
	}
	tr.incompatible td {
		color: var(--text-3);
	}
	tr.note td {
		border-top: none;
		padding-top: 0;
		font-size: 0.78rem;
	}
	tr:has(+ tr.note) td {
		border-bottom: none;
	}
	.act {
		text-align: right;
		white-space: nowrap;
	}
	.actions {
		justify-content: flex-end;
	}
	@media (max-width: 760px) {
		.c-ctx,
		.c-think {
			display: none;
		}
		.c-model {
			min-width: 11rem;
		}
	}
</style>
