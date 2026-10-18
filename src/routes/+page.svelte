<script lang="ts">
	import type { PageProps } from './$types';
	import BarChart from '#lib/components/BarChart.svelte';
	import ProgressMeter from '#lib/components/ProgressMeter.svelte';
	import HelpLink from '#lib/components/HelpLink.svelte';
	import HowItWorks from '#lib/components/HowItWorks.svelte';
	import { fmtUsd } from '#lib/cost.ts';
	import InstallCard from '#lib/components/InstallCard.svelte';
	import { onMount } from 'svelte';
	import { daily, dailyDone } from '#lib/client/daily.svelte.ts';
	import { aiMode, aiUi } from '#lib/client/ai.svelte.ts';

	const ai = $derived(aiUi());

	// Aviso si hay progreso que perder y el navegador puede borrarlo (sin protección o con poco espacio).
	let storageRisk = $state('');
	onMount(async () => {
		const cards = Object.values(data.profile.counts).reduce((a, c) => a + c.learning + c.review + c.mastered, 0);
		if (cards < 100 || !navigator.storage) return;
		const [persisted, est] = await Promise.all([navigator.storage.persisted?.(), navigator.storage.estimate?.()]);
		if (est?.usage && est.quota && est.usage / est.quota > 0.8) storageRisk = 'Queda poco espacio para Sensei en este navegador.';
		else if (persisted === false) storageRisk = 'El navegador puede borrar tus datos si necesita espacio.';
	});

	let { data }: PageProps = $props();
	const p = $derived(data.profile);
	const k = $derived(p.counts.kanji ?? { learning: 0, review: 0, mastered: 0 });
	const v = $derived(p.counts.vocab ?? { learning: 0, review: 0, mastered: 0 });
	// «Lecciones hoy»: solo lo que de verdad se puede aprender hoy (sin «0 kanji» mientras se aprenden kana, ni
	// palabras que aún no se desbloquearon).
	const q = $derived(data.quota);
	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
	const lessonsLeft = $derived(
		[
			q.kanaAvailable > 0 && q.kanaLeft > 0 ? `${q.kanaLeft} kana` : '',
			!q.kanjiLocked && q.kanjiLeft > 0 ? `${q.kanjiLeft} kanji` : '',
			q.vocabAvailable > 0 && q.vocabLeft > 0 ? plural(q.vocabLeft, 'palabra', 'palabras') : '',
			q.grammarAvailable > 0 && q.grammarLeft > 0 ? plural(q.grammarLeft, 'punto de gramática', 'puntos de gramática') : ''
		]
			.filter(Boolean)
			.join(' · ')
	);
	const lessonsDone = $derived.by(() => {
		const parts = [
			q.kanaLearnedToday ? `${q.kanaLearnedToday} kana` : '',
			q.kanjiLearnedToday ? `${q.kanjiLearnedToday} kanji` : '',
			q.vocabLearnedToday ? plural(q.vocabLearnedToday, 'palabra', 'palabras') : ''
		].filter(Boolean);
		return parts.length ? `Hoy ya aprendiste ${parts.join(', ')}` : 'Aún nada nuevo hoy';
	});
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
	<div class="row">
		{#if p.streakDays}<span class="badge">🔥 {p.streakDays} días de racha</span>{/if}
		<!-- Modo actual de la IA (se cambia en Ajustes). -->
		<a class="badge mode" class:off={!ai} href="/ajustes#ia" title="Cambiar en Ajustes">
			{ai ? '智 IA activada' : aiMode() === 'off' ? '無 Modo sin IA' : '無 IA sin activar'}
		</a>
	</div>
</div>

{#if !data.onboardingDone}
	<div class="card small row">
		<span>¿Primera vez con Sensei? La bienvenida explica el método en 3 minutos.</span>
		<a class="btn small" href="/bienvenida">Ver bienvenida</a>
	</div>
{/if}

<InstallCard />

{#if storageRisk}
	<div class="card small row">
		<span>⚠ {storageRisk} Protégelos o descarga una copia.</span>
		<a class="btn small" href="/datos#almacenamiento">Almacenamiento</a>
	</div>
{/if}

{#if ai && (data.budget.level === 'warn' || data.budget.level === 'over')}
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

{#if data.daily.steps && !(daily.active && dailyDone())}
	<a class="card daily" href="/hoy">
		<span class="jp big">今</span>
		<span class="grow">
			<strong>{daily.active ? 'Seguir con tu sesión de hoy' : 'Empezar mi sesión de hoy'}</strong>
			<span class="small muted">Repasos, lección y lectura seguidos, en ~{data.daily.minutes} min (eliges 10, 20 o 40).</span>
		</span>
		<span class="btn primary">{daily.active ? 'Seguir' : 'Empezar'} →</span>
	</a>
{/if}

{#if data.steps.length}
	{@const [first, ...rest] = data.steps}
	<section class="card next">
		<span class="small muted">Siguiente paso</span>
		<div class="spread">
			<h2>{first.title}</h2>
			<a class="btn primary" href={first.href}>{first.cta} →</a>
		</div>
		<p class="why"><strong>Por qué:</strong> {first.why} <HowItWorks part="lectura" /></p>
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
					<span class:jp={!!m.badge}>{m.badge ?? m.kanji}</span>
				</span>
			{/each}
		</div>
		{#if j.next}
			<p>
				<strong>Próxima meta: {j.next.title}</strong>
				{#if j.next.kanji}({j.known}/{j.next.kanji} kanji){:else if j.next.kana}({Math.round(j.progressToNext * 100)} % firmes){/if} — {j.next.unlocks}
			</p>
			{#if j.next.kanji || j.next.kana}
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
		<span class="value">{lessonsLeft || 'Cupo de hoy completo'}</span>
		<span class="small dim">{lessonsDone}</span>
		{#if q.kanjiLocked}
			<span class="small dim">Los kanji empiezan al terminar el hiragana básico (te faltan {q.hiraganaLeft}).</span>
		{/if}
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
			<ProgressMeter label="Kana" learning={kn.learning} review={kn.review} mastered={kn.mastered} total={data.kanaCards} />
		{/if}
	</div>
	<div class="card">
		<h2>Previsión de repasos</h2>
		<BarChart title="Repasos que vencen cada día (próximos 7 días)" labels={data.forecast.labels} values={data.forecast.values} unit="repasos" />
	</div>
</div>

<div class="two">
	{#if ai}
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
	{/if}
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
			{#if ai}<a class="btn small" href="/tutor?nuevo=confusiones">Practicar con el tutor</a>{/if}
		{/if}
	</div>
</div>

<div class="row">
	{#if ai}
		<a class="btn" href="/lectura">📖 Lectura graduada</a>
		<a class="btn" href="/explicar">🔍 Explicar texto o foto</a>
	{/if}
	<a class="btn" href="/biblioteca">書 Biblioteca</a>
	<a class="btn" href="/kanji">字 Mapa de kanji</a>
</div>

<style>
	.mode {
		color: var(--accent-2);
	}
	.mode.off {
		color: var(--text-2);
	}
	.mode:hover {
		text-decoration: none;
		border-color: var(--text-3);
	}
	.daily {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		color: var(--text);
		border-left: 3px solid var(--accent);
	}
	.daily:hover {
		text-decoration: none;
		background: var(--bg-3);
	}
	.daily .big {
		font-size: 2rem;
		color: var(--accent);
	}
	.daily .grow {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
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
