<script lang="ts">
	// Datos → «Preparar por adelantado»: genera ya (con tu key) mnemotecnias, nombres de componentes, glosas y frases de
	// los próximos kanji que vas a estudiar. Por tandas: se ve el progreso y el costo, se puede parar y retomar otro día
	// (lo que ya está hecho no se repite). Lo que viene con el diccionario (pregenerado) ya cuenta como hecho.
	import { onMount } from 'svelte';
	import { get, post, errMsg } from '../client/api.ts';
	import { fmtUsd, type OperationCost } from '../cost.ts';
	import { toast } from '../client/toast.svelte.ts';

	let { gemini }: { gemini: boolean } = $props();

	type Status = { total: number; done: number; nextKanji: string[] };
	const AHEAD = [50, 100, 300];
	let ahead = $state(100);
	let st = $state<Status | null>(null);
	let running = $state(false);
	let stop = false;
	let spent = $state(0);

	async function load() {
		st = await get<Status>(`/api/pregen?ahead=${ahead}`);
	}

	async function run() {
		running = true;
		stop = false;
		spent = 0;
		const start = st?.done ?? 0;
		try {
			while (!stop && st && st.nextKanji.length) {
				const before = st.nextKanji.length;
				const r = await post<{ status: Status; cost: OperationCost | null }>('/api/pregen', { ahead });
				st = r.status;
				spent += r.cost?.usd ?? 0;
				// Sin avance (p. ej. la API no devolvió nada útil): parar en vez de repetir.
				if (st.nextKanji.length >= before) {
					toast.error('No se pudo preparar la siguiente tanda', { detail: 'Prueba de nuevo más tarde: lo hecho se conserva.' });
					break;
				}
			}
			const done = (st?.done ?? 0) - start;
			if (done > 0)
				toast.success(stop ? `Pausado: ${done} kanji preparados` : `${done} kanji preparados`, {
					detail: `Costo: ${fmtUsd(spent)}.${stop ? ' Puedes seguir cuando quieras.' : ''}`
				});
		} catch (e) {
			toast.error('Se detuvo la preparación', { detail: `${errMsg(e)} Lo hecho se conserva.` });
		} finally {
			running = false;
		}
	}

	onMount(() => {
		load().catch((e) => toast.error('No se pudo leer el estado', { detail: errMsg(e) }));
	});
	const pct = $derived(st && st.total ? Math.round((st.done / st.total) * 100) : 0);
</script>

<section class="card stack" id="preparar">
	<h2>Preparar por adelantado</h2>
	<p class="small muted">
		Genera ya las mnemotecnias, los nombres de componentes, las glosas en español y las frases de los próximos kanji que vas a
		estudiar: las lecciones abren al instante y puedes estudiar sin conexión. Lo que ya viene con el diccionario o ya tienes no se
		vuelve a generar.
	</p>
	<div class="row small">
		<span>Próximos</span>
		{#each AHEAD as n (n)}
			<button class="small" class:primary={ahead === n} disabled={running} onclick={() => { ahead = n; void load(); }}>{n} kanji</button>
		{/each}
	</div>
	{#if st}
		<div class="small">
			{#if st.total === 0}No quedan kanji por estudiar.{:else}<strong>{st.done}</strong> de {st.total} preparados ({pct} %).{/if}
		</div>
		<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct}><div style="width:{pct}%"></div></div>
		<div class="row">
			{#if running}
				<button onclick={() => (stop = true)}>Parar</button>
				<span class="small"><span class="spinner"></span> Preparando… {spent ? `(${fmtUsd(spent)} hasta ahora)` : ''}</span>
			{:else if st.nextKanji.length}
				<button class="primary" onclick={run} disabled={!gemini}>Preparar los {st.nextKanji.length} que faltan</button>
				{#if !gemini}<span class="small dim">Necesita la API key de Gemini (Ajustes).</span>{/if}
				{#if spent}<span class="small dim">Última vez: {fmtUsd(spent)}</span>{/if}
			{:else if st.total}
				<span class="small ok-text">✓ Todo listo.</span>
			{/if}
		</div>
	{/if}
	<p class="small dim">
		Va en tandas de 8 kanji (unas 4-5 llamadas cortas por tanda). Con el perfil Equilibrado, 100 kanji suelen costar menos de unos
		céntimos de dólar; el costo real aparece en Costos.
	</p>
</section>

<style>
	.bar {
		height: 6px;
		border-radius: 999px;
		background: var(--bg-3);
		overflow: hidden;
	}
	.bar div {
		height: 100%;
		background: var(--series-1);
	}
	.ok-text {
		color: var(--ok);
	}
</style>
