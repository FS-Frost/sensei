<script lang="ts">
	import type { PageProps } from './$types';
	import BarChart from '#lib/components/BarChart.svelte';
	import ProgressMeter from '#lib/components/ProgressMeter.svelte';
	import HelpLink from '#lib/components/HelpLink.svelte';
	import { fmtUsd } from '#lib/cost.ts';
	import InstallCard from '#lib/components/InstallCard.svelte';

	let { data }: PageProps = $props();
	const p = $derived(data.profile);
	const k = $derived(p.counts.kanji ?? { learning: 0, review: 0, mastered: 0 });
	const v = $derived(p.counts.vocab ?? { learning: 0, review: 0, mastered: 0 });
	const brakeMsg = $derived(
		data.quota.brake === 'stop'
			? 'Lecciones en pausa: tienes muchos repasos pendientes.'
			: data.quota.brake === 'half'
				? 'Lecciones reducidas a la mitad por acumulación de repasos.'
				: ''
	);
</script>

<svelte:head><title>Sensei</title></svelte:head>

<div class="spread">
	<h1>おかえり <span class="muted small">— bienvenido de vuelta</span> <HelpLink section="inicio" /></h1>
	{#if p.streakDays}<span class="badge">🔥 {p.streakDays} días de racha</span>{/if}
</div>

{#if !data.onboardingDone}
	<div class="card small row">
		<span>¿Primera vez con Sensei? La bienvenida explica el método en 3 minutos.</span>
		<a class="btn small" href="/bienvenida">Ver bienvenida</a>
	</div>
{/if}

<InstallCard />

{#if data.budget.level === 'warn' || data.budget.level === 'over'}
	{@const b = data.budget}
	<div class="card small row budget" class:over={b.level === 'over'}>
		<span>
			{b.level === 'over' ? '⛔ Presupuesto de Gemini superado' : '⚠ Cerca del presupuesto de Gemini'}:
			{fmtUsd(b.spent)} de {fmtUsd(b.budget)} este mes ({Math.round((b.ratio ?? 0) * 100)} %).
			{#if b.level === 'warn'}Proyección a fin de mes: {fmtUsd(b.projected)}.{/if}
		</span>
		<a class="btn small" href="/costos">Ver costos</a>
	</div>
{/if}

{#if data.steps.length}
	{@const [first, ...rest] = data.steps}
	<section class="card next">
		<span class="small muted">Siguiente paso</span>
		<div class="spread">
			<h2>{first.title}</h2>
			<a class="btn primary" href={first.href}>{first.cta} →</a>
		</div>
		<p class="why"><strong>Por qué:</strong> {first.why}</p>
		{#if rest.length}
			<details>
				<summary class="small muted">Después, o si prefieres ({rest.length})</summary>
				<ul class="alts">
					{#each rest as s (s.id)}
						<li>
							<a href={s.href}>{s.title}</a>
							<span class="small muted">— {s.why}</span>
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	</section>
{/if}

{#if data.journey}
	{@const j = data.journey}
	<section class="card journey">
		<div class="spread">
			<span class="small muted">Tu viaje · {j.known} kanji aprendidos</span>
			<a class="small" href="/guia#ruta">Ver la ruta completa</a>
		</div>
		<div class="stages">
			{#each j.milestones as m (m.id)}
				<span class="stage" class:reached={m.reached} class:next={j.next?.id === m.id} title="{m.title}: {m.unlocks}">
					{m.kanji || 'かな'}
				</span>
			{/each}
		</div>
		{#if j.next}
			<p>
				<strong>Próxima meta: {j.next.title}</strong>
				{#if j.next.kanji}({j.known}/{j.next.kanji} kanji){/if} — {j.next.unlocks}
			</p>
			{#if j.next.kanji}
				<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(j.progressToNext * 100)}>
					<div style="width:{j.progressToNext * 100}%"></div>
				</div>
			{/if}
			<p class="small muted">Consejo: {j.next.tip}</p>
		{:else}
			<p><strong>Has completado la ruta.</strong> Ahora manda el vocabulario: lee mucho y añade palabras desde lo que leas.</p>
		{/if}
		{#if j.goal}
			{@const g = j.goal}
			<div class="goal" class:off={!g.onTrack && g.remaining > 0}>
				<strong>Tu objetivo: {g.label}</strong>
				<span class="small muted">{g.known}/{g.target} kanji · {g.daysLeft} días</span>
				<div class="bar"><div style="width:{Math.min(100, (g.known / Math.max(1, g.target)) * 100)}%"></div></div>
				<span class="small">{g.message}</span>
				{#if g.textId}<a class="small" href="/biblioteca/{g.textId}">Ver el texto</a>{/if}
			</div>
		{:else}
			<a class="small" href="/ajustes#objetivo">＋ Ponte un objetivo con fecha («leer X para tal día»)</a>
		{/if}
	</section>
{/if}

<div class="tiles">
	<a class="card tile" href="/repaso">
		<span class="small muted">Repasos pendientes</span>
		<span class="hero">{p.due}</span>
		<span class="small dim">{p.due ? 'Empezar repaso →' : 'Todo al día'}</span>
	</a>
	<a class="card tile" href="/leccion">
		<span class="small muted">Lecciones hoy</span>
		<span class="value">{data.quota.kanjiLeft} kanji · {data.quota.vocabLeft} palabras</span>
		<span class="small dim">
			{data.quota.kanjiLearnedToday} kanji y {data.quota.vocabLearnedToday} palabras nuevas hoy
		</span>
	</a>
	<div class="card tile">
		<span class="small muted">Precisión (7 días)</span>
		<span class="value">{p.accuracy7d ?? '—'}{p.accuracy7d !== null ? '%' : ''}</span>
		<span class="small dim">{p.reviews7d} respuestas</span>
	</div>
</div>

{#if brakeMsg}<div class="warning small">{brakeMsg}</div>{/if}

<div class="two">
	<div class="card stack">
		<h2>Progreso</h2>
		<ProgressMeter label="Kanji" learning={k.learning} review={k.review} mastered={k.mastered} total={data.totalKanji} />
		<ProgressMeter
			label="Vocabulario"
			learning={v.learning}
			review={v.review}
			mastered={v.mastered}
			total={v.learning + v.review + v.mastered || 1}
		/>
		{#if data.kanaCards}
			{@const kn = p.counts.kana ?? { learning: 0, review: 0, mastered: 0 }}
			<ProgressMeter label="Kana débiles" learning={kn.learning} review={kn.review} mastered={kn.mastered} total={data.kanaCards} />
		{/if}
	</div>
	<div class="card">
		<h2>Previsión de repasos</h2>
		<BarChart title="Repasos que vencen cada día (próximos 7 días)" labels={data.forecast.labels} values={data.forecast.values} unit="repasos" />
	</div>
</div>

<div class="two">
	<div class="card stack">
		<div class="spread">
			<h2>Tutor</h2>
			<a class="btn small" href="/tutor">Abrir</a>
		</div>
		<div class="row">
			<a class="btn small" href="/tutor?nuevo=conversacion">Conversación-quiz</a>
			<a class="btn small" href="/tutor?nuevo=quiz">Quiz a medida</a>
			<a class="btn small" href="/tutor?nuevo=confusiones">Confusiones</a>
		</div>
		{#each data.sessions as s (s.id)}
			<a class="session" href="/tutor/{s.id}">
				<span>{s.title ?? s.mode}</span>
				<span class="dim small">{new Date(s.lastAt).toLocaleDateString('es')}</span>
			</a>
		{/each}
	</div>
	<div class="card stack">
		<h2>Puntos débiles</h2>
		{#if p.weakItems.length}
			<div class="row jp weak">
				{#each p.weakItems as w (w.type + w.key)}
					<span data-lookup={w.display} title="{w.fails} fallos">{w.display}</span>
				{/each}
			</div>
		{:else}
			<p class="muted small">Aún nada: ¡sigue repasando!</p>
		{/if}
		{#if p.confusions.length}
			<h3>Confusiones</h3>
			<div class="row jp">
				{#each p.confusions as c (c.kind + c.a + c.b)}
					<span class="badge">{c.a} / {c.b} ×{c.count}</span>
				{/each}
			</div>
			<a class="btn small" href="/tutor?nuevo=confusiones">Practicar con el tutor</a>
		{/if}
	</div>
</div>

<div class="row">
	<a class="btn" href="/lectura">📖 Lectura graduada</a>
	<a class="btn" href="/explicar">🔍 Explicar texto o foto</a>
	<a class="btn" href="/kanji">字 Mapa de kanji</a>
</div>

<style>
	.budget {
		border-color: var(--warn);
		justify-content: space-between;
	}
	.budget.over {
		border-color: var(--bad);
	}
	.next {
		border-color: var(--accent);
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.next h2 {
		margin: 0;
	}
	.why {
		margin: 0;
		color: var(--text-2);
	}
	.alts {
		margin: 0.4rem 0 0;
		padding-left: 1.1rem;
		display: grid;
		gap: 0.3rem;
	}
	.journey {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.journey p {
		margin: 0;
	}
	.stages {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
	}
	.stage {
		font-size: 0.8rem;
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		border: 1px solid var(--line);
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
	.stage.reached {
		background: var(--ord-2);
		border-color: var(--ord-2);
		color: var(--ord-2-ink);
	}
	.stage.next {
		border-color: var(--accent);
		color: var(--text);
	}
	.bar {
		height: 8px;
		background: var(--bg-3);
		border-radius: 4px;
		overflow: hidden;
	}
	.bar div {
		height: 100%;
		background: var(--series-1);
		border-radius: 4px;
	}
	.goal {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		border-top: 1px solid var(--line);
		padding-top: 0.6rem;
	}
	.goal.off {
		color: var(--warn);
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 1rem;
	}
	.tile {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		color: var(--text);
	}
	a.tile:hover {
		text-decoration: none;
		border-color: var(--text-3);
	}
	.hero {
		font-size: 3rem;
		font-weight: 600;
		line-height: 1.1;
	}
	.value {
		font-size: 1.4rem;
		font-weight: 600;
	}
	.two {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: 1rem;
	}
	.session {
		display: flex;
		justify-content: space-between;
		color: var(--text-2);
		border-top: 1px solid var(--line);
		padding-top: 0.4rem;
	}
	.weak {
		font-size: 1.5rem;
	}
</style>
