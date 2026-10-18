<script lang="ts">
	// Sesión diaria guiada: plan de hoy (con tu ritmo real), recorrido paso a paso y resumen al final.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { get, errMsg } from '#lib/client/api.ts';
	import HelpLink from '#lib/components/HelpLink.svelte';
	import { completeDaily, currentStep, daily, dailyDone, endDaily, goNext, startDaily, type DailyStepId } from '#lib/client/daily.svelte.ts';
	import { keepAwake } from '#lib/client/wakeLock.ts';

	type Step = { id: DailyStepId; title: string; detail: string; href: string; minutes: number };
	type Plan = { budget: number; minutes: number; steps: Step[]; pace: { secsPerReview: number; fromHistory: boolean } };
	type Summary = {
		reviews: number;
		correct: number;
		accuracy: number | null;
		newCards: number;
		readings: number;
		readingChars: number;
		minutes: number;
		due: number;
		tomorrow: number;
	};

	const BUDGET_KEY = 'sensei.dailyMinutes';
	const BUDGETS = [10, 20, 40];
	let budget = $state(20);
	let plan = $state<Plan | null>(null);
	let summary = $state<Summary | null>(null);
	let error = $state('');
	const resumen = $derived(page.url.searchParams.has('resumen'));

	async function load() {
		error = '';
		try {
			const r = await get<{ plan: Plan; summary: Summary }>(`/api/daily?min=${budget}`);
			plan = r.plan;
			summary = r.summary;
		} catch (e) {
			error = errMsg(e);
		}
	}

	function setBudget(m: number) {
		budget = m;
		try {
			localStorage.setItem(BUDGET_KEY, String(m));
		} catch {
			/* sin almacenamiento */
		}
		void load();
	}

	onMount(() => {
		try {
			const m = Number(localStorage.getItem(BUDGET_KEY));
			if (BUDGETS.includes(m)) budget = m;
		} catch {
			/* sin almacenamiento */
		}
		// El resumen local es el «cierre» sin API key: verlo cuenta como hecho.
		if (resumen) completeDaily('close');
		void load();
		return keepAwake();
	});

	const active = $derived(daily.active);
	const cur = $derived(active ? currentStep() : null);
	const finished = $derived(active ? dailyDone() : false);
	const fmtMin = (m: number) => `${m} min`;
</script>

<svelte:head><title>Hoy · Sensei</title></svelte:head>

<h1>Tu sesión de hoy <HelpLink section="hoy" /></h1>
{#if error}<div class="error small">{error}</div>{/if}

{#if finished || resumen}
	<section class="card stack done">
		<h2>{finished ? '✓ Sesión completa' : 'Resumen del día'}</h2>
		{#if summary}
			<div class="stats">
				<div><strong>{summary.reviews}</strong><span class="small muted">respuestas</span></div>
				<div><strong>{summary.accuracy ?? '—'}{summary.accuracy != null ? ' %' : ''}</strong><span class="small muted">correctas</span></div>
				<div><strong>{summary.newCards}</strong><span class="small muted">tarjetas nuevas</span></div>
				<div><strong>{summary.readingChars}</strong><span class="small muted">caracteres leídos</span></div>
				<div><strong>~{summary.minutes}</strong><span class="small muted">minutos</span></div>
			</div>
			<p class="small muted">
				{summary.due ? `Quedan ${summary.due} repasos pendientes.` : 'No quedan repasos pendientes.'}
				{summary.tomorrow > 0 ? ` Mañana vencen unos ${summary.tomorrow} más.` : ''} Volver cada día, aunque sea poco, es lo que hace que funcione.
			</p>
		{/if}
		<div class="row">
			<a class="btn" href="/">Inicio</a>
			{#if finished}<button class="ghost" onclick={endDaily}>Cerrar la sesión de hoy</button>{/if}
		</div>
	</section>
{/if}

{#if active && !finished}
	<section class="card stack">
		<h2>En curso</h2>
		<ol class="plan">
			{#each active.steps as s (s.id)}
				<li class:done={s.status === 'done'} class:skipped={s.status === 'skipped'} class:cur={s === cur}>
					<span class="state">{s.status === 'done' ? '✓' : s.status === 'skipped' ? 'saltado' : s === cur ? '▶' : ''}</span>
					<span class="t">{s.title}</span>
					<span class="small dim">{fmtMin(s.minutes)}</span>
				</li>
			{/each}
		</ol>
		<div class="row">
			{#if cur}<button class="primary" onclick={goNext}>Seguir: {cur.title} →</button>{/if}
			<button class="ghost" onclick={endDaily}>Terminar por hoy</button>
		</div>
	</section>
{:else if !active && plan}
	<section class="card stack">
		<div class="spread">
			<h2>Plan para hoy · ~{fmtMin(plan.minutes)}</h2>
			<div class="budgets" role="group" aria-label="Tiempo disponible">
				{#each BUDGETS as m (m)}
					<button class="small" class:primary={budget === m} aria-pressed={budget === m} onclick={() => setBudget(m)}>{m} min</button>
				{/each}
			</div>
		</div>
		{#if plan.steps.length}
			<ol class="plan">
				{#each plan.steps as s (s.id)}
					<li>
						<span class="t"><strong>{s.title}</strong> <span class="small muted">— {s.detail}</span></span>
						<span class="small dim">{fmtMin(s.minutes)}</span>
					</li>
				{/each}
			</ol>
			<div class="row">
				<button class="primary big" onclick={() => startDaily(budget, plan!.steps)}>Empezar (~{fmtMin(plan.minutes)})</button>
			</div>
			<p class="small dim">
				{plan.pace.fromHistory
					? `Tiempos según tu ritmo real (~${Math.round(plan.pace.secsPerReview)} s por repaso).`
					: 'Tiempos aproximados: se ajustarán a tu ritmo cuando tengas historial.'}
				Puedes saltar un bloque o terminar cuando quieras; lo hecho cuenta.
			</p>
		{:else}
			<p>No queda nada pendiente hoy. 🎉 Si te apetece, lee algo de tu <a href="/biblioteca">biblioteca</a>.</p>
		{/if}
	</section>
{/if}

<style>
	.plan {
		margin: 0;
		padding-left: 1.2rem;
		display: grid;
		gap: 0.5rem;
	}
	.plan li {
		display: flex;
		gap: 0.6rem;
		align-items: baseline;
	}
	.plan .t {
		flex: 1;
	}
	.plan li.done {
		color: var(--ok);
	}
	.plan li.skipped .t {
		text-decoration: line-through;
		color: var(--text-3);
	}
	.plan li.cur {
		font-weight: 600;
	}
	.state {
		min-width: 1.2rem;
	}
	.budgets {
		display: flex;
		gap: 0.3rem;
	}
	.big {
		padding: 0.7rem 1.3rem;
		font-size: 1.05rem;
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
		gap: 0.6rem;
	}
	.stats div {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.stats strong {
		font-size: 1.5rem;
	}
	.done {
		border-left: 3px solid var(--ok);
	}
</style>
