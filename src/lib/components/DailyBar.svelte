<script lang="ts">
	// Tarjeta de la sesión diaria: visible en todas las pantallas (menos /hoy) mientras hay una sesión de hoy en curso.
	// Cabecera fija (título, «paso X de N», cerrar arriba a la derecha), barra por pasos y el paso en curso con su botón.
	import { page } from '$app/state';
	import { base } from '../client/base.ts';
	import { currentStep, daily, dailyDone, endDaily, goNext, restoreDaily, skipDaily } from '../client/daily.svelte.ts';
	import { toast } from '../client/toast.svelte.ts';

	const path = $derived(page.url.pathname.slice(base.length) || '/');
	const cur = $derived(daily.active ? currentStep() : null);
	const done = $derived(daily.active ? dailyDone() : false);
	// ¿Estoy en la pantalla del paso en curso? Si no (p. ej. acabo de terminar el anterior), ofrecer ir.
	const onCurrent = $derived(!!cur && path === cur.href.split('?')[0]);
	const steps = $derived(daily.active?.steps ?? []);
	const idx = $derived(steps.findIndex((s) => s === cur));
	const left = $derived(steps.filter((s) => s.status === 'todo').reduce((m, s) => m + s.minutes, 0));
	const hidden = $derived(path === '/hoy');

	function end() {
		const saved = endDaily();
		if (saved)
			toast.info('Sesión de hoy terminada', {
				key: 'daily',
				actions: [{ label: 'Deshacer', run: () => restoreDaily(saved) }]
			});
	}
</script>

{#if daily.active && !hidden}
	<section class="daily card" class:pending={!!cur && !onCurrent} aria-label="Sesión de hoy">
		<header>
			<a class="title" href="/hoy">Sesión de hoy</a>
			<span class="meta">
				{#if done}completa ✓{:else if cur}paso {idx + 1} de {steps.length} · ~{left} min{/if}
			</span>
			<button class="close ghost" onclick={end} aria-label="Terminar la sesión de hoy" title="Terminar la sesión de hoy">✕</button>
		</header>
		<ol class="bar" aria-hidden="true">
			{#each steps as s (s.id)}
				<li class:done={s.status === 'done'} class:skipped={s.status === 'skipped'} class:cur={s === cur} title={s.title}></li>
			{/each}
		</ol>
		<div class="now">
			{#if done}
				<span class="what">Has hecho todo lo de hoy.</span>
				<a class="btn small primary" href="/hoy">Ver resumen</a>
			{:else if cur}
				<span class="what">
					{#if onCurrent}<span class="dim">Ahora:</span>{:else}<span class="dim">{idx > 0 ? 'Siguiente:' : 'Empieza por:'}</span>{/if}
					<strong>{cur.title}</strong>
					<span class="dim mins">~{cur.minutes} min</span>
				</span>
				{#if onCurrent}
					<button class="small" onclick={skipDaily} title="Pasar al siguiente bloque">Saltar paso</button>
				{:else}
					<button class="small primary" onclick={goNext}>{idx > 0 ? 'Continuar' : 'Ir'} →</button>
				{/if}
			{/if}
		</div>
	</section>
{/if}

<style>
	.daily {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.55rem 0.75rem 0.65rem;
		border-left: 4px solid var(--accent);
	}
	/* Hay que ir a otro sitio: que se note más (fondo con algo de acento). */
	.daily.pending {
		background: color-mix(in srgb, var(--accent) 9%, var(--bg-2));
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 0;
	}
	.title {
		font-weight: 700;
		color: var(--accent);
		white-space: nowrap;
	}
	.meta {
		flex: 1;
		min-width: 0;
		color: var(--text-2);
		font-size: 0.85rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.close {
		flex-shrink: 0;
		margin: -0.25rem -0.35rem -0.25rem 0;
		padding: 0.15rem 0.5rem;
		border: none;
		color: var(--text-3);
	}
	.close:hover {
		color: var(--text);
	}
	.bar {
		display: flex;
		gap: 3px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.bar li {
		flex: 1;
		height: 6px;
		border-radius: 3px;
		background: var(--bg-3);
	}
	.bar li.done {
		background: var(--ok);
	}
	.bar li.skipped {
		background: var(--text-3);
		opacity: 0.5;
	}
	.bar li.cur {
		background: var(--accent);
	}
	.now {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.what {
		flex: 1;
		min-width: 12rem;
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.what strong {
		font-size: 1rem;
	}
	.dim {
		font-size: 0.85rem;
	}
	@media (max-width: 520px) {
		.what .mins {
			display: none;
		}
	}
</style>
