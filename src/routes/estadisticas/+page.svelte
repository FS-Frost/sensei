<script lang="ts">
	import HelpLink from '#lib/components/HelpLink.svelte';
	import type { PageProps } from './$types';
	import BarChart from '#lib/components/BarChart.svelte';
	import ProgressMeter from '#lib/components/ProgressMeter.svelte';
	import { post, errMsg } from '#lib/client/api.ts';

	let { data }: PageProps = $props();
	const TYPE: Record<string, string> = {
		kana: 'Kana',
		component: 'Componentes',
		kanji: 'Kanji',
		vocab: 'Vocabulario',
		grammar: 'Gramática',
		sentence: 'Frases'
	};

	let busy: Record<number, boolean> = $state({});
	let msg: Record<number, string> = $state({});
	async function treat(cardId: number, action: 'pause' | 'mnemonic') {
		busy[cardId] = true;
		try {
			const r = await post<{ due?: number; meaning?: string }>('/api/leech', { cardId, action, days: 7 });
			msg[cardId] = action === 'pause' ? `apartada hasta el ${new Date(r.due!).toLocaleDateString('es')}` : 'mnemotecnia nueva lista (mírala en la ficha)';
		} catch (e) {
			msg[cardId] = errMsg(e);
		} finally {
			busy[cardId] = false;
		}
	}
	const SOURCE: Record<string, string> = { review: 'Repaso', lesson: 'Lección', quiz: 'Quiz del tutor', diagnostic: 'Diagnóstico' };
	const pct = (ok: number, n: number) => (n ? `${Math.round((ok / n) * 100)}%` : '—');
	const accValues = $derived(data.daily.accuracy.map((a) => a ?? 0));
</script>

<svelte:head><title>Estadísticas · Sensei</title></svelte:head>

<h1>Estadísticas <HelpLink section="estadisticas" /></h1>

<div class="tiles">
	<div class="card tile"><span class="small muted">Racha</span><span class="value">{data.profile.streakDays} días</span></div>
	<div class="card tile"><span class="small muted">Tarjetas</span><span class="value">{data.totals?.cards ?? 0}</span></div>
	<div class="card tile"><span class="small muted">Respuestas totales</span><span class="value">{data.totals?.reviews ?? 0}</span></div>
	<div class="card tile"><span class="small muted">Tiempo estudiando</span><span class="value">{data.totals?.minutes ?? 0} min</span></div>
</div>

<div class="card">
	<h2>Actividad</h2>
	<BarChart title="Respuestas por día (últimos 30 días)" labels={data.daily.labels} values={data.daily.reviews} unit="respuestas" />
</div>

<div class="card">
	<h2>Precisión diaria</h2>
	<BarChart title="% de aciertos por día (0 = sin actividad)" labels={data.daily.labels} values={accValues} unit="%" />
</div>

{#if data.speed.length}
	<div class="card">
		<h2>Velocidad de lectura</h2>
		<BarChart
			title="Caracteres por minuto en tus lecturas cronometradas"
			labels={data.speed.map((x) => new Date(x.at).toLocaleDateString('es', { day: 'numeric', month: 'short' }))}
			values={data.speed.map((x) => x.cpm)}
			unit="car/min"
		/>
	</div>
{/if}

<div class="card stack" id="sanguijuelas">
	<h2>Tarjetas que se resisten</h2>
	{#if data.leeches.length}
		<p class="small muted">
			Las has fallado muchas veces después de haberlas aprendido. Repetirlas igual no
			funciona: genera una mnemotecnia nueva, compárala con sus parecidos o apártala unos días.
		</p>
		<table class="small">
			<thead><tr><th>Ítem</th><th>Tipo</th><th>Fallos</th><th></th></tr></thead>
			<tbody>
				{#each data.leeches as l (l.id)}
					<tr>
						<td class="jp big-cell">{#if l.type === 'kanji'}<a href="/kanji/{l.key}">{l.display}</a>{:else}<span data-lookup={l.display}>{l.display}</span>{/if}</td>
						<td>{TYPE[l.type] ?? l.type} · {l.facet === 'meaning' ? 'significado' : l.facet === 'writing' ? 'escritura' : 'lectura'}</td>
						<td class="num">{l.lapses}</td>
						<td class="acts">
							{#if l.type === 'kanji'}
								<button class="small" onclick={() => treat(l.id, 'mnemonic')} disabled={busy[l.id]}>Nueva mnemotecnia</button>
								<!-- Escribirlo a mano fija la forma: ayuda a separarlo de sus parecidos. -->
								<a class="btn small" href="/kanji/{l.key}#escribir">✍ Escribirlo</a>
							{/if}
							<button class="small" onclick={() => treat(l.id, 'pause')} disabled={busy[l.id]}>Apartar 7 días</button>
							{#if msg[l.id]}<span class="muted">{msg[l.id]}</span>{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<a class="btn small" href="/tutor?nuevo=confusiones">Practicar con el detective de confusiones</a>
	{:else}
		<p class="small muted">Ninguna por ahora. Aparecen cuando fallas 6 veces o más una tarjeta ya aprendida.</p>
	{/if}
</div>

<div class="card">
	<h2>Previsión</h2>
	<BarChart title="Repasos que vencen cada día (próximas 2 semanas)" labels={data.forecast.labels} values={data.forecast.values} unit="repasos" />
</div>

<div class="two">
	<div class="card stack">
		<h2>Por tipo</h2>
		{#each Object.entries(data.profile.counts) as [t, c] (t)}
			<ProgressMeter label={TYPE[t] ?? t} learning={c.learning} review={c.review} mastered={c.mastered} total={c.learning + c.review + c.mastered} />
		{/each}
		{#if data.byType.length}
			<table class="small">
				<thead><tr><th>Tipo (30 días)</th><th>Respuestas</th><th>Aciertos</th></tr></thead>
				<tbody>
					{#each data.byType as r (r.t)}
						<tr><td>{TYPE[r.t] ?? r.t}</td><td class="num">{r.n}</td><td class="num">{pct(r.ok, r.n)}</td></tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
	<div class="card stack">
		<h2>Por origen</h2>
		<table class="small">
			<thead><tr><th>Origen</th><th>Respuestas</th><th>Aciertos</th></tr></thead>
			<tbody>
				{#each data.bySource as r (r.source)}
					<tr><td>{SOURCE[r.source] ?? r.source}</td><td class="num">{r.n}</td><td class="num">{pct(r.ok, r.n)}</td></tr>
				{/each}
			</tbody>
		</table>
		{#if data.profile.weakItems.length}
			<h3>Ítems más fallados (30 días)</h3>
			<div class="row jp weak">
				{#each data.profile.weakItems as w (w.type + w.key)}
					<span data-lookup={w.display} title="{w.fails} fallos">{w.display}<sub class="dim">{w.fails}</sub></span>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 1rem;
	}
	.tile {
		display: flex;
		flex-direction: column;
	}
	.value {
		font-size: 1.5rem;
		font-weight: 600;
	}
	.two {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: 1rem;
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
	}
	th {
		color: var(--text-2);
		font-weight: 500;
	}
	.num {
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
	.weak {
		font-size: 1.4rem;
	}
	.big-cell {
		font-size: 1.3rem;
	}
	.acts {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
		align-items: center;
	}
</style>
