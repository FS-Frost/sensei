<script lang="ts">
	// Barra de la sesión diaria: visible en todas las pantallas mientras hay una sesión de hoy en curso.
	import { page } from '$app/state';
	import { base } from '../client/base.ts';
	import { currentStep, daily, dailyDone, endDaily, goNext, skipDaily } from '../client/daily.svelte.ts';

	const path = $derived(page.url.pathname.slice(base.length) || '/');
	const cur = $derived(daily.active ? currentStep() : null);
	const done = $derived(daily.active ? dailyDone() : false);
	// ¿Estoy en la pantalla del paso en curso? Si no (p. ej. acabo de terminar el anterior), ofrecer ir.
	const onCurrent = $derived(!!cur && path === cur.href.split('?')[0]);
	const idx = $derived(daily.active ? daily.active.steps.findIndex((s) => s === cur) : -1);
	const hidden = $derived(path === '/hoy');
</script>

{#if daily.active && !hidden}
	<div class="daily card small" role="region" aria-label="Sesión de hoy">
		<a class="title" href="/hoy">Hoy</a>
		<ol class="steps">
			{#each daily.active.steps as s, i (s.id)}
				<li class:done={s.status === 'done'} class:skipped={s.status === 'skipped'} class:cur={s === cur}>
					<span class="dot" aria-hidden="true">{s.status === 'done' ? '✓' : s.status === 'skipped' ? '–' : i + 1}</span>
					<span class="label">{s.title}</span>
				</li>
			{/each}
		</ol>
		<span class="grow"></span>
		{#if done}
			<a class="btn small primary" href="/hoy">Sesión completa ✓</a>
		{:else if cur && !onCurrent}
			<button class="small primary" onclick={goNext}>{idx > 0 ? 'Siguiente' : 'Ir'}: {cur.title} →</button>
		{:else if cur}
			<button class="small ghost" onclick={skipDaily} title="Pasar al siguiente bloque">Saltar</button>
		{/if}
		<button class="small ghost" onclick={endDaily} title="Terminar la sesión de hoy">✕</button>
	</div>
{/if}

<style>
	.daily {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.45rem 0.7rem;
		flex-wrap: wrap;
		border-left: 3px solid var(--accent);
	}
	.title {
		font-weight: 700;
		color: var(--accent);
	}
	.steps {
		display: flex;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
		flex-wrap: wrap;
	}
	.steps li {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		color: var(--text-3);
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
	}
	.steps li.cur {
		color: var(--text);
		background: var(--bg-3);
	}
	.steps li.done {
		color: var(--ok);
	}
	.steps li.skipped .label {
		text-decoration: line-through;
	}
	.dot {
		font-variant-numeric: tabular-nums;
	}
	.grow {
		flex: 1;
	}
	@media (max-width: 760px) {
		.steps li:not(.cur) .label {
			display: none;
		}
	}
</style>
