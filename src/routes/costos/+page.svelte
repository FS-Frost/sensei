<script lang="ts">
	import { onMount } from 'svelte';
	import { get, post, errMsg } from '#lib/client/api.ts';
	import { fmtTokens, fmtUsd } from '#lib/cost.ts';
	import { MODE_LABEL } from '#lib/tutorModes.ts';
	import type { ChatMode } from '#lib/types.ts';
	import BarChart from '#lib/components/BarChart.svelte';
	import HelpLink from '#lib/components/HelpLink.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';

	type Tier = { from: string; input: number; cached: number; output: number };
	type Prices = Record<string, Tier[]>;
	type Part = { key: string; label: string; usd: number; calls: number };
	type Group = {
		key: string;
		label: string;
		usd: number;
		calls: number;
		prompt: number;
		cached: number;
		cacheRatio: number;
		saved: number;
		output: number;
		parts: Part[];
	};
	type Report = {
		range: number;
		totals: {
			usd: number;
			calls: number;
			failed: number;
			unpriced: number;
			prompt: number;
			cached: number;
			output: number;
			thoughts: number;
			tool: number;
			image: number;
		};
		month: { usd: number; calls: number };
		prevMonth: { usd: number; calls: number };
		allTime: { usd: number; calls: number };
		budget: { budget: number | null; spent: number; projected: number; ratio: number | null; level: 'none' | 'ok' | 'warn' | 'over' };
		daily: { day: string; usd: number; calls: number }[];
		byFeature: Group[];
		byModel: Group[];
		topSessions: { id: number; title: string | null; mode: string | null; usd: number; calls: number; last: number; deleted: boolean }[];
		recent: {
			id: number;
			at: number;
			model: string;
			feature: string;
			label: string;
			sessionId: number | null;
			promptTokens: number;
			cachedTokens: number;
			outputTokens: number;
			thoughtsTokens: number;
			imageTokens: number;
			costUsd: number | null;
			ok: boolean;
		}[];
	};
	type Info = {
		report: Report;
		prices: Prices;
		defaults: Prices;
		custom: boolean;
		configured: { role: 'pro' | 'flash'; model: string; priced: boolean }[];
		budget: number | null;
		hardStop: boolean;
	};

	let info = $state<Info | null>(null);
	let range = $state(30);
	let error = $state('');
	let msg = $state('');
	let busy = $state(false);

	const RANGES = [
		[7, '7 días'],
		[30, '30 días'],
		[90, '90 días'],
		[0, 'Todo']
	] as const;

	async function load() {
		info = await get<Info>(`/api/costs?range=${range}`);
		if (!editing) prices = clone(info.prices);
		budget = info.budget;
	}

	function done(text: string) {
		msg = text;
		error = '';
		setTimeout(() => (msg = ''), 5000);
	}

	const r = $derived(info?.report);
	const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short' });
	const fmtWhen = (t: number) => new Date(t).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
	const ROLE: Record<string, string> = { pro: 'Pro', flash: 'Flash' };
	const roleOf = (model: string) => info?.configured.find((c) => c.model === model)?.role;
	const maxFeature = $derived(Math.max(0, ...(r?.byFeature.map((f) => f.usd) ?? [])));
	const unpricedConfigured = $derived(info?.configured.filter((c) => !c.priced) ?? []);
	const LEVEL = { none: '', ok: '✓ Dentro del presupuesto', warn: '⚠ Cerca del presupuesto', over: '⛔ Presupuesto superado' };

	// ---------- Precios ----------
	const clone = (p: Prices): Prices => JSON.parse(JSON.stringify(p));
	let prices: Prices = $state({});
	let editing = $state(false);
	let newModel = $state('');

	function addModel() {
		const m = newModel.trim();
		if (!m || prices[m]) return;
		prices[m] = [{ from: '2000-01-01', input: 0, cached: 0, output: 0 }];
		newModel = '';
		editing = true;
	}
	function addTier(model: string) {
		const today = new Date().toISOString().slice(0, 10);
		const last = prices[model].at(-1)!;
		prices[model] = [...prices[model], { ...last, from: today }];
		editing = true;
	}
	function removeTier(model: string, i: number) {
		prices[model] = prices[model].filter((_, j) => j !== i);
		if (!prices[model].length) delete prices[model];
		editing = true;
	}

	async function savePrices(reset = false) {
		busy = true;
		try {
			await post('/api/costs', { prices: reset ? null : prices });
			editing = false;
			await load();
			done(reset ? 'Precios por defecto restaurados.' : 'Precios guardados. Se aplican a las llamadas nuevas.');
		} catch (e) {
			error = errMsg(e);
		} finally {
			busy = false;
		}
	}

	let recomputeOpen = $state(false);
	async function recompute() {
		busy = true;
		try {
			const res = await post<{ recomputed: number }>('/api/costs', { recompute: true });
			recomputeOpen = false;
			await load();
			done(`Recalculadas ${res.recomputed} llamadas con los precios actuales.`);
		} catch (e) {
			error = errMsg(e);
		} finally {
			busy = false;
		}
	}

	// ---------- Presupuesto ----------
	// bind:value de un input numérico da number (o null si está vacío).
	let budget: number | null = $state(null);
	async function saveBudget() {
		busy = true;
		try {
			const value = budget && budget > 0 ? budget : null;
			await post('/api/costs', { budget: value });
			await load();
			done(value ? 'Presupuesto guardado.' : 'Presupuesto quitado.');
		} catch (e) {
			error = errMsg(e);
		} finally {
			busy = false;
		}
	}

	async function saveHardStop(on: boolean) {
		busy = true;
		try {
			await post('/api/costs', { hardStop: on });
			await load();
			done(on ? 'Gemini se bloqueará al superar el presupuesto.' : 'Solo avisará al superar el presupuesto.');
		} catch (e) {
			error = errMsg(e);
		} finally {
			busy = false;
		}
	}

	function setRange(v: number) {
		range = v;
		load().catch((e) => (error = errMsg(e)));
	}

	onMount(() => {
		load().catch((e) => (error = errMsg(e)));
	});
</script>

<svelte:head><title>Costos · Sensei</title></svelte:head>

<h1>Costos de Gemini <HelpLink section="costos" /></h1>
<p class="muted small">
	Cada llamada a Gemini guarda sus tokens y su costo con el precio de ese día. Es una <strong>estimación</strong>: la factura real
	está en Google AI Studio.
</p>

{#if msg}<div class="card ok small">{msg}</div>{/if}
{#if error}<div class="error small">{error}</div>{/if}

{#if unpricedConfigured.length}
	<div class="card small warnbox">
		⚠ Sin precio: {unpricedConfigured.map((c) => `${c.model} (${ROLE[c.role]})`).join(', ')}. Sus llamadas cuentan como «sin precio»
		hasta que lo añadas abajo.
	</div>
{/if}

{#if r}
	<div class="tiles">
		<div class="card tile">
			<span class="small muted">Este mes</span>
			<span class="value">{fmtUsd(r.month.usd)}</span>
			<span class="small dim">{r.month.calls} llamadas · proyección {fmtUsd(r.budget.projected)}</span>
		</div>
		<div class="card tile">
			<span class="small muted">Mes anterior</span>
			<span class="value">{fmtUsd(r.prevMonth.usd)}</span>
			<span class="small dim">{r.prevMonth.calls} llamadas</span>
		</div>
		<div class="card tile">
			<span class="small muted">Desde el principio</span>
			<span class="value">{fmtUsd(r.allTime.usd)}</span>
			<span class="small dim">{r.allTime.calls} llamadas</span>
		</div>
		<div class="card tile">
			<span class="small muted">Presupuesto mensual</span>
			{#if r.budget.budget}
				<span class="value">{Math.round((r.budget.ratio ?? 0) * 100)} %</span>
				<div
					class="meter"
					role="progressbar"
					aria-label="Gasto del mes frente al presupuesto"
					aria-valuemin="0"
					aria-valuemax="100"
					aria-valuenow={Math.round(Math.min(1, r.budget.ratio ?? 0) * 100)}
				>
					<div class="fill {r.budget.level}" style="width:{Math.min(1, r.budget.ratio ?? 0) * 100}%"></div>
				</div>
				<span class="small dim">{LEVEL[r.budget.level]} · {fmtUsd(r.budget.spent)} de {fmtUsd(r.budget.budget)}</span>
			{:else}
				<span class="value dim">—</span>
				<span class="small dim">Sin presupuesto (ponlo abajo)</span>
			{/if}
		</div>
	</div>

	<div class="row ranges" role="group" aria-label="Periodo">
		<span class="small muted">Periodo:</span>
		{#each RANGES as [v, l] (v)}
			<button class="small" class:primary={range === v} aria-pressed={range === v} onclick={() => setRange(v)}>{l}</button>
		{/each}
		<span class="small dim">
			{fmtUsd(r.totals.usd)} en {r.totals.calls} llamadas{#if r.totals.failed} · {r.totals.failed} fallidas (no se cobran){/if}{#if r.totals.unpriced}
				· {r.totals.unpriced} sin precio{/if}
		</span>
	</div>

	<div class="card">
		<h2>Gasto por día</h2>
		{#if r.daily.length}
			<BarChart title="Costo estimado por día (USD)" labels={r.daily.map((d) => fmtDay(d.day))} values={r.daily.map((d) => d.usd)} format={fmtUsd} />
		{:else}
			<p class="small dim">Aún no hay llamadas registradas.</p>
		{/if}
	</div>

	<div class="two">
		<div class="card stack">
			<h2>Por función</h2>
			{#if r.byFeature.length}
				<ul class="hbars">
					{#each r.byFeature as f (f.key)}
						<li>
							<div class="spread small">
								<span>{f.label}</span>
								<span class="num"><strong>{fmtUsd(f.usd)}</strong> · {f.calls} llam.</span>
							</div>
							<div class="track" title="{f.label}: {fmtUsd(f.usd)}">
								<div class="bar" style="width:{maxFeature ? (f.usd / maxFeature) * 100 : 0}%"></div>
							</div>
							<div class="small dim">
								{#each f.parts as p, i (p.key)}{i ? ' · ' : ''}<code>{p.key}</code>{#if roleOf(p.key)}&nbsp;({ROLE[roleOf(p.key)!]}){/if}{f.parts.length > 1 ? ` ${fmtUsd(p.usd)}` : ''}{/each}
							</div>
							{#if f.prompt}
								<div class="small dim" title="Entrada servida desde la caché de Gemini: se cobra a ~1/10">
									Caché: {Math.round(f.cacheRatio * 100)} % de la entrada{#if f.saved >= 0.001} · ahorro ≈ {fmtUsd(f.saved)}{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="small dim">Sin llamadas en este periodo.</p>
			{/if}
		</div>

		<div class="card stack">
			<h2>Por modelo</h2>
			{#if r.byModel.length}
				<table class="small">
					<thead><tr><th>Modelo</th><th>Se usa para</th><th class="num">Llam.</th><th class="num">Costo</th></tr></thead>
					<tbody>
						{#each r.byModel as m (m.key)}
							<tr>
								<td>
									<code>{m.key}</code>
									{#if roleOf(m.key)}<span class="badge">{ROLE[roleOf(m.key)!]}</span>{/if}
								</td>
								<td>{m.parts.map((p) => p.label).join(', ')}</td>
								<td class="num">{m.calls}</td>
								<td class="num">{fmtUsd(m.usd)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{:else}
				<p class="small dim">Sin llamadas en este periodo.</p>
			{/if}
			<p class="small dim">
				Ahora: <strong>Pro</strong> = {info?.configured[0].model} (tutor, lecturas, explicador, mnemotecnias);
				<strong>Flash</strong> = {info?.configured[1].model} (resúmenes, informe, «¿Por qué?», traducciones, nombres, kanji parecidos).
				Se cambian en <a href="/ajustes">Ajustes</a>.
			</p>
		</div>
	</div>

	<div class="two">
		<div class="card stack">
			<h2>Tokens</h2>
			<table class="small">
				<tbody>
					<tr><td>Entrada</td><td class="num">{fmtTokens(r.totals.prompt)}</td><td class="dim">tu historial, instrucciones y lo que envías</td></tr>
					<tr><td>Entrada desde caché</td><td class="num">{fmtTokens(r.totals.cached)}</td><td class="dim">se cobra mucho más barata</td></tr>
					<tr><td>Herramientas</td><td class="num">{fmtTokens(r.totals.tool)}</td><td class="dim">resultados de herramientas (precio de entrada)</td></tr>
					<tr><td>Salida</td><td class="num">{fmtTokens(r.totals.output)}</td><td class="dim">lo que escribe Gemini</td></tr>
					<tr><td>Razonamiento</td><td class="num">{fmtTokens(r.totals.thoughts)}</td><td class="dim">«pensamiento» interno (precio de salida)</td></tr>
					<tr><td>de ello, imágenes</td><td class="num">{fmtTokens(r.totals.image)}</td><td class="dim">fotos del explicador (incluidas en entrada)</td></tr>
				</tbody>
			</table>
		</div>

		<div class="card stack">
			<h2>Sesiones del tutor más caras</h2>
			{#if r.topSessions.length}
				<table class="small">
					<thead><tr><th>Sesión</th><th class="num">Llam.</th><th class="num">Costo</th></tr></thead>
					<tbody>
						{#each r.topSessions as t (t.id)}
							<tr>
								<td>
									{#if t.deleted}<span class="dim">Sesión borrada</span>{:else}<a href="/tutor/{t.id}"
											>{t.title ?? MODE_LABEL[t.mode as ChatMode] ?? 'Sesión'}</a
										>{/if}
								</td>
								<td class="num">{t.calls}</td>
								<td class="num">{fmtUsd(t.usd)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<p class="small dim">Las sesiones largas cuestan más por turno: cada respuesta reenvía todo el historial.</p>
			{:else}
				<p class="small dim">Sin sesiones en este periodo.</p>
			{/if}
		</div>
	</div>

	<details class="card">
		<summary>Últimas llamadas ({r.recent.length})</summary>
		<div class="scroll">
			<table class="small">
				<thead>
					<tr><th>Cuándo</th><th>Función</th><th>Modelo</th><th class="num">Entrada</th><th class="num">Salida</th><th class="num">Costo</th></tr>
				</thead>
				<tbody>
					{#each r.recent as c (c.id)}
						<tr class:failed={!c.ok}>
							<td>{fmtWhen(c.at)}</td>
							<td>
								{#if c.sessionId}<a href="/tutor/{c.sessionId}">{c.label}</a>{:else}{c.label}{/if}
								{#if !c.ok}<span class="badge">fallida</span>{/if}
							</td>
							<td><code>{c.model}</code></td>
							<td class="num">{fmtTokens(c.promptTokens)}{#if c.cachedTokens}<span class="dim"> ({fmtTokens(c.cachedTokens)} caché)</span>{/if}</td>
							<td class="num">{fmtTokens(c.outputTokens + c.thoughtsTokens)}</td>
							<td class="num">{c.costUsd == null ? 'sin precio' : fmtUsd(c.costUsd)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</details>
{/if}

<div class="two">
	<div class="card stack">
		<h2>Presupuesto mensual</h2>
		<p class="small muted">Inicio avisa al llegar al 80 % y al superarlo.</p>
		<div class="row">
			<label class="budget">
				USD/mes
				<input type="number" min="0" step="0.5" bind:value={budget} placeholder="sin presupuesto" />
			</label>
			<button onclick={saveBudget} disabled={busy}>Guardar</button>
		</div>
		<label class="inline small">
			<input type="checkbox" checked={info?.hardStop ?? false} onchange={(e) => saveHardStop((e.target as HTMLInputElement).checked)} disabled={busy} />
			Bloquear Gemini al superarlo (protege la key si alguien más usa este navegador)
		</label>
	</div>

	<div class="card stack">
		<h2>Recalcular el historial</h2>
		<p class="small muted">
			Lo normal es dejar cada llamada con el precio que tenía. Si corregiste un precio mal puesto, recalcula todo el historial con la tabla
			actual (respetando las fechas de cada tramo).
		</p>
		<div><button onclick={() => (recomputeOpen = true)} disabled={busy}>Recalcular con precios actuales…</button></div>
	</div>
</div>

{#if info}
	<div class="card stack">
		<div class="spread">
			<h2>Precios (USD por 1 M de tokens)</h2>
			<span class="small dim">{info.custom ? 'Editados por ti' : 'Por defecto'}</span>
		</div>
		<p class="small muted">
			Cada modelo tiene tramos con fecha «desde»: así se cargan subidas anunciadas. Un modelo se reconoce también por prefijo
			(<code>gemini-4-argon</code> vale para <code>gemini-4-argon-preview</code>). Fuente de los valores por defecto:
			<a href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noreferrer">precios de la API de Gemini</a> (nivel de pago).
		</p>
		{#each Object.entries(prices) as [model, tiers] (model)}
			<div class="model">
				<div class="spread">
					<strong><code>{model}</code></strong>
					<button class="small ghost" onclick={() => addTier(model)}>＋ Tramo</button>
				</div>
				<table class="small prices">
					<thead><tr><th>Desde</th><th>Entrada</th><th>Caché</th><th>Salida</th><th></th></tr></thead>
					<tbody>
						{#each tiers as t, i (i)}
							<tr>
								<td><input type="date" bind:value={t.from} oninput={() => (editing = true)} aria-label="Desde" /></td>
								<td><input type="number" min="0" step="0.01" bind:value={t.input} oninput={() => (editing = true)} aria-label="Entrada" /></td>
								<td><input type="number" min="0" step="0.001" bind:value={t.cached} oninput={() => (editing = true)} aria-label="Caché" /></td>
								<td><input type="number" min="0" step="0.01" bind:value={t.output} oninput={() => (editing = true)} aria-label="Salida" /></td>
								<td><button class="small ghost" title="Quitar tramo" aria-label="Quitar tramo" onclick={() => removeTier(model, i)}>✕</button></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/each}
		<div class="row">
			<input class="grow" bind:value={newModel} placeholder="Otro modelo (p. ej. gemini-4-argon-lite)" aria-label="Nombre del modelo" />
			<button class="small" onclick={addModel} disabled={!newModel.trim()}>Añadir modelo</button>
		</div>
		<p class="small dim">Los modelos por defecto no se pueden quitar, solo cambiar su precio.</p>
		<div class="row">
			<button class="primary" onclick={() => savePrices()} disabled={busy || !editing}>Guardar precios</button>
			{#if editing}<button class="ghost" onclick={() => ((prices = clone(info!.prices)), (editing = false))}>Descartar cambios</button>{/if}
			{#if info.custom}<button class="ghost" onclick={() => savePrices(true)} disabled={busy}>Restaurar por defecto</button>{/if}
		</div>
	</div>
{/if}

<ConfirmDialog bind:open={recomputeOpen} title="Recalcular costos" confirmLabel="Recalcular" {busy} onconfirm={recompute}>
	<p>Se recalcula el costo de todas las llamadas guardadas con la tabla de precios actual. Los tokens no cambian.</p>
</ConfirmDialog>

<style>
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
		gap: 1rem;
	}
	.tile {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.value {
		font-size: 1.5rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.meter {
		height: 8px;
		border-radius: 999px;
		background: var(--bg-3);
		overflow: hidden;
		margin: 0.2rem 0;
	}
	.fill {
		height: 100%;
		border-radius: 999px;
		background: var(--ok);
	}
	.fill.warn {
		background: var(--warn);
	}
	.fill.over {
		background: var(--bad);
	}
	.ranges {
		align-items: center;
	}
	.two {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: 1rem;
	}
	.hbars {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.7rem;
	}
	.track {
		height: 10px;
		margin: 0.2rem 0;
	}
	.bar {
		height: 100%;
		min-width: 2px;
		background: var(--series-1);
		border-radius: 0 4px 4px 0;
	}
	table {
		border-collapse: collapse;
		width: 100%;
	}
	th,
	td {
		text-align: left;
		padding: 0.3rem 0.4rem;
		border-bottom: 1px solid var(--line);
		vertical-align: middle;
	}
	th {
		color: var(--text-2);
		font-weight: 500;
	}
	.num {
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
	}
	.scroll {
		overflow-x: auto;
		margin-top: 0.6rem;
	}
	tr.failed td {
		color: var(--text-3);
	}
	.badge {
		margin-left: 0.3rem;
	}
	.model {
		border-top: 1px solid var(--line);
		padding-top: 0.6rem;
	}
	.prices input {
		padding: 0.25rem 0.4rem;
		min-width: 0;
		width: 100%;
	}
	.prices td:first-child {
		min-width: 9rem;
	}
	.budget {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
	}
	.budget input {
		width: 9rem;
	}
	.inline {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0;
		color: var(--text-2);
	}
	.inline input {
		width: auto;
	}
	.ok {
		border-color: var(--ok);
	}
	.warnbox {
		border-color: var(--warn);
	}
	.grow {
		flex: 1;
	}
	summary {
		cursor: pointer;
		font-weight: 500;
	}
</style>
