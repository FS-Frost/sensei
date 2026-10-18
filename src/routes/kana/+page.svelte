<script lang="ts">
	// Kana: tu avance (mapa por estado), el diagnóstico adaptativo (si ya sabes algo) y práctica de lectura con
	// palabras reales. Las lecciones de kana viven en /leccion, como el resto.
	import HelpLink from '#lib/components/HelpLink.svelte';
	import HowItWorks from '#lib/components/HowItWorks.svelte';
	import type { PageProps } from './$types';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import KanaDiagnostic, { type Outcome } from '#lib/components/KanaDiagnostic.svelte';
	import KanaPractice from '#lib/components/KanaPractice.svelte';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import type { KanaScript } from '#lib/kanaCourse.ts';
	import type { ItemStatus } from '#lib/types.ts';

	let { data }: PageProps = $props();

	let stage: 'idle' | 'diag' | 'done' = $state('idle');
	let diagScripts: KanaScript[] = $state(['hiragana', 'katakana']);
	let outcome: Outcome | null = $state(null);

	// Desde la bienvenida: /kana?diag=hiragana,katakana arranca el diagnóstico de esas escrituras.
	onMount(() => {
		const d = page.url.searchParams.get('diag');
		if (d) {
			const s = d.split(',').filter((x): x is KanaScript => x === 'hiragana' || x === 'katakana');
			if (s.length) startDiag(s);
		}
	});

	function startDiag(s: KanaScript[]) {
		diagScripts = s;
		outcome = null;
		stage = 'diag';
	}

	const kanjiNext = $derived(!!data.startLevel && data.startLevel.kanji !== 'none' && !data.placementDone);
	const pct = (x: { taught: number; total: number }) => Math.round((x.taught / Math.max(1, x.total)) * 100);
	const GROUP: Record<string, string> = {
		basic: 'Básicos',
		dakuten: 'Con ゛ y ゜',
		yoon: 'Combinados',
		special: 'っ pequeña y ー',
		extended: 'Extendidos (palabras extranjeras)'
	};
	const groupsOf = (script: KanaScript) => {
		const rows = data.rows.filter((r) => r.script === script);
		return [...new Set(rows.map((r) => r.group))].map((g) => ({ group: g, rows: rows.filter((r) => r.group === g) }));
	};
	const status = (k: string): ItemStatus => (data.statuses as Record<string, ItemStatus>)[k] ?? 'none';
</script>

<svelte:head><title>Kana · Sensei</title></svelte:head>

<h1>Kana <HelpLink section="kana" /> <HowItWorks part="adaptativos" /></h1>

{#if stage === 'diag'}
	<div class="card stack">
		<h2>Diagnóstico de kana</h2>
		<KanaDiagnostic
			scripts={diagScripts}
			ondone={(r) => {
				outcome = r;
				stage = 'done';
			}}
		/>
	</div>
{:else if stage === 'done' && outcome}
	<div class="card stack">
		<h2>Resultado</h2>
		{#if outcome.known}<p>✓ <strong>{outcome.known}</strong> kana dominados: quedan en repaso y volverán dentro de unas semanas para confirmarlo.</p>{/if}
		{#if outcome.weak.length}
			<p>Estos entran a tu SRS para afianzarlos:</p>
			<div class="row jp weak">
				{#each outcome.weak as w (w.kana)}
					<span class="badge" title={w.reason === 'slow' ? 'lento' : `respondiste «${w.answer}»`}>
						{w.kana} <span class="dim">{w.reason === 'slow' ? '⏱' : '✗'}</span>
					</span>
				{/each}
			</div>
		{/if}
		{#each outcome.skipped as s (s)}
			<p>El <strong>{s}</strong> lo aprenderás desde cero: las lecciones van fila a fila, con una imagen para cada kana.</p>
		{/each}
		<div class="row">
			{#if outcome.weak.length}<a class="btn" href="/repaso">Repasar los dudosos</a>{/if}
			{#if kanjiNext && !outcome.skipped.includes('hiragana')}
				<a class="btn primary" href="/nivel">Siguiente: test de nivel de kanji</a>
			{:else}
				<a class="btn primary" href="/leccion">Ir a la lección</a>
			{/if}
		</div>
	</div>
{/if}

<div class="card stack">
	<div class="spread">
		<h2>Tu avance</h2>
		<a class="btn small primary" href="/leccion">Lección →</a>
	</div>
	<div class="bars">
		{#each [['Hiragana', data.progress.hiragana], ['Katakana', data.progress.katakana]] as const as [label, p] (label)}
			<div>
				<div class="spread small"><span>{label}</span><span class="dim">{p.taught}/{p.total} estudiados · {p.solid} firmes</span></div>
				<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct(p)}><div style="width:{pct(p)}%"></div></div>
			</div>
		{/each}
	</div>
	{#if !data.hiraganaReady}
		<p class="small muted">Las lecciones de kanji empiezan cuando termines el hiragana básico: todo en japonés se lee con kana.</p>
	{/if}
	{#if stage !== 'diag'}
		<div class="row small">
			<span class="muted">¿Ya sabes algo?</span>
			<button class="small" onclick={() => startDiag(['hiragana', 'katakana'])}>Diagnóstico (~5 min)</button>
			<button class="small ghost" onclick={() => startDiag(['hiragana'])}>Solo hiragana</button>
			<button class="small ghost" onclick={() => startDiag(['katakana'])}>Solo katakana</button>
		</div>
		<p class="dim small">
			Adaptativo: empieza con una muestra corta; si fallas mucho, esa escritura se aprende desde cero. Lo que domines queda
			en repaso; lo dudoso (fallo o más de 4 s), a aprender.
		</p>
	{/if}
</div>

<div class="card stack" id="practica">
	<h2>Practicar lectura</h2>
	<KanaPractice />
</div>

{#each ['hiragana', 'katakana'] as const as script (script)}
	<div class="card stack">
		<h2>{script === 'hiragana' ? 'Hiragana' : 'Katakana'}</h2>
		{#each groupsOf(script) as g (g.group)}
			<h3 class="small muted">{GROUP[g.group]}</h3>
			<div class="map">
				{#each g.rows as r (r.id)}
					<div class="krow">
						{#each r.chars as c, ci (c)}
							<span class="cell st-{status(c)}" title="{r.romaji[ci]} · {r.title}">
								<span class="jp">{c}</span><small>{r.romaji[ci] === '-' ? 'ー' : r.romaji[ci]}</small>
							</span>
						{/each}
					</div>
				{/each}
			</div>
		{/each}
		<div class="row small legend">
			<StatusBadge status="none" /><StatusBadge status="learning" /><StatusBadge status="review" /><StatusBadge status="mastered" />
		</div>
	</div>
{/each}

<style>
	.weak {
		font-size: 1.4rem;
	}
	.bars {
		display: grid;
		gap: 0.6rem;
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
	.map {
		display: grid;
		gap: 0.3rem;
	}
	.krow {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.cell {
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		min-width: 3.1rem;
		padding: 0.2rem 0.3rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		line-height: 1.15;
	}
	.cell .jp {
		font-size: 1.35rem;
	}
	.cell small {
		font-size: 0.68rem;
		color: var(--text-3);
	}
	/* Estado como intensidad de la misma serie ordinal que el resto de la app (aprendiendo → repaso → dominado). */
	.st-learning {
		background: var(--ord-1);
		border-color: var(--ord-1);
	}
	.st-learning .jp,
	.st-learning small {
		color: var(--ord-1-ink);
	}
	.st-review {
		background: var(--ord-2);
		border-color: var(--ord-2);
	}
	.st-review .jp,
	.st-review small {
		color: var(--ord-2-ink);
	}
	.st-mastered {
		background: var(--ord-3);
		border-color: var(--ord-3);
	}
	.st-mastered .jp,
	.st-mastered small {
		color: var(--ord-3-ink);
	}
	.legend {
		gap: 0.4rem;
	}
</style>
