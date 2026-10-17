<script lang="ts">
	import { goto } from '#lib/client/nav.ts';
	import { get, post, errMsg } from '#lib/client/api.ts';
	import AnswerInput from '#lib/components/AnswerInput.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import HelpLink from '#lib/components/HelpLink.svelte';

	type Sample = { band: number; range: [number, number]; kanji: string[]; bands: number };

	let stage: 'intro' | 'test' | 'result' = $state('intro');
	let sample: Sample | null = $state(null);
	let i = $state(0);
	let answer = $state('');
	let feedback: { correct: boolean; answers: string[] } | null = $state(null);
	let bandScore = $state(0);
	let results: { band: number; range: [number, number]; score: number }[] = $state([]);
	let confirmed: string[] = $state([]);
	let failsInRow = $state(0);
	let error = $state('');
	let applyOpen = $state(false);
	let busy = $state(false);
	let applied = $state('');

	const PASS = 4; // de 5

	async function loadBand(band: number) {
		sample = await get<Sample>(`/api/placement?band=${band}`);
		i = 0;
		bandScore = 0;
		answer = '';
		feedback = null;
	}

	async function start() {
		stage = 'test';
		results = [];
		confirmed = [];
		failsInRow = 0;
		await loadBand(0);
	}

	async function submit(skip = false) {
		if (!sample || feedback) return;
		const char = sample.kanji[i];
		const r = skip ? { correct: false, answers: [] } : await post<{ correct: boolean; answers: string[] }>('/api/placement', { action: 'check', char, answer });
		feedback = r;
		if (r.correct) {
			bandScore++;
			confirmed = [...confirmed, char];
		}
		setTimeout(nextQ, r.correct ? 400 : 1200);
	}

	async function nextQ() {
		if (!sample) return;
		feedback = null;
		answer = '';
		if (i + 1 < sample.kanji.length) {
			i++;
			return;
		}
		results = [...results, { band: sample.band, range: sample.range, score: bandScore }];
		failsInRow = bandScore < PASS ? failsInRow + 1 : 0;
		// Se para tras 2 franjas seguidas sin dominar, o al final.
		if (failsInRow >= 2 || sample.band + 1 >= sample.bands) stage = 'result';
		else await loadBand(sample.band + 1);
	}

	/** Hasta dónde se da por conocido: fin de la última franja superada sin huecos. */
	const upTo = $derived.by(() => {
		let limit = 0;
		for (const r of results) {
			if (r.score >= PASS) limit = r.range[1];
			else break;
		}
		return limit;
	});

	async function apply() {
		busy = true;
		try {
			const r = await post<{ kanji: number; components: number; cards: number }>('/api/placement', { action: 'apply', upTo, confirmed });
			applyOpen = false;
			applied = `Marcados ${r.kanji} kanji y ${r.components} componentes como conocidos (${r.cards} tarjetas). Irán apareciendo en tus repasos las próximas 2 semanas para confirmarlo.`;
		} catch (e) {
			error = errMsg(e);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Test de nivel · Sensei</title></svelte:head>

<h1>Test de nivel de kanji <HelpLink section="nivel" /></h1>

{#if stage === 'intro'}
	<div class="card stack">
		<p>
			¿Ya sabes algunos kanji? Este test te pregunta el <strong>significado</strong> de 5 kanji por franja, siguiendo tu orden de
			aprendizaje (los 50 primeros, del 50 al 100, del 100 al 200…). Si aciertas {PASS} de 5, la franja se da por conocida.
		</p>
		<p class="small muted">
			Se detiene tras dos franjas seguidas sin dominar. Lo que marques como conocido no se da por hecho: entra «en repaso» con repasos
			repartidos en 2 semanas, así se confirma sin saturarte. Si empiezas de cero, no lo necesitas.
		</p>
		<div class="row">
			<button class="primary" onclick={() => start().catch((e) => (error = errMsg(e)))}>Empezar</button>
			<a class="btn" href="/">Ahora no</a>
		</div>
	</div>
{:else if stage === 'test' && sample}
	<div class="test">
		<div class="small muted">Franja {sample.band + 1}: kanji {sample.range[0] + 1}–{sample.range[1]} · {i + 1}/5</div>
		<div class="kanji jp" class:ok={feedback?.correct} class:bad={feedback && !feedback.correct}>{sample.kanji[i]}</div>
		<div class="hint">{#if feedback && !feedback.correct}{feedback.answers.join('; ') || '—'}{/if}</div>
		<AnswerInput bind:value={answer} mode="meaning" disabled={!!feedback} onsubmit={() => submit()} placeholder="Significado en español" />
		<button class="ghost small" onclick={() => submit(true)} disabled={!!feedback}>No lo sé</button>
	</div>
{:else if stage === 'result'}
	<div class="card stack">
		<h2>Resultado</h2>
		<ul>
			{#each results as r (r.band)}
				<li>Kanji {r.range[0] + 1}–{r.range[1]}: {r.score}/5 {r.score >= PASS ? '✓' : ''}</li>
			{/each}
		</ul>
		{#if applied}
			<p>{applied}</p>
			<button class="primary" onclick={() => goto('/', { refreshAll: true })}>Ir al inicio</button>
		{:else if upTo > 0 || confirmed.length}
			<p>
				Propuesta: dar por conocidos los <strong>{upTo}</strong> primeros kanji{confirmed.length ? ` y los ${confirmed.length} que acertaste sueltos` : ''},
				con sus componentes.
			</p>
			<button class="primary" onclick={() => (applyOpen = true)}>Aplicar</button>
		{:else}
			<p>Empezarás desde el principio: es lo mejor para construir bien los componentes.</p>
			<a class="btn primary" href="/leccion">Primera lección</a>
		{/if}
	</div>
{/if}
{#if error}<div class="error small">{error}</div>{/if}

<ConfirmDialog bind:open={applyOpen} title="Marcar como conocidos" confirmLabel="Aplicar" danger={false} {busy} onconfirm={apply}>
	<p>Se crearán tarjetas «en repaso» para esos kanji y sus componentes. Antes se guarda una copia de seguridad.</p>
</ConfirmDialog>

<style>
	.test {
		max-width: 420px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		align-items: center;
		width: 100%;
	}
	.kanji {
		font-size: 6rem;
		line-height: 1.1;
		background: var(--kanji);
		color: #fff;
		width: 100%;
		text-align: center;
		border-radius: var(--radius);
		padding: 0.4rem;
	}
	.kanji.ok {
		background: var(--ok);
	}
	.kanji.bad {
		background: var(--bad);
	}
	.hint {
		min-height: 1.4rem;
		color: var(--bad);
	}
</style>
