<script lang="ts">
	import { toast } from '#lib/client/toast.svelte.ts';
	import HelpLink from '#lib/components/HelpLink.svelte';
	import { onMount } from 'svelte';
	import { get, post, errMsg } from '#lib/client/api.ts';
	import type { JpToken } from '#lib/types.ts';
	import JpTokens from '#lib/components/JpTokens.svelte';
	import SpeakButton from '#lib/components/SpeakButton.svelte';
	import AddWordButton from '#lib/components/AddWordButton.svelte';
	import MineSentence from '#lib/components/MineSentence.svelte';
	import ReadTimer from '#lib/components/ReadTimer.svelte';
	import { setScreenContext } from '#lib/client/tutorContext.svelte.ts';
	import CostNote from '#lib/components/CostNote.svelte';
	import type { OperationCost } from '#lib/cost.ts';

	type Reading = {
		title: string;
		lines: { speaker?: string; tokens: JpToken[]; es: string }[];
		new_words: { word: string; reading: string; es: string }[];
		questions: { q: string; options: string[]; answer_index: number; explanation: string }[];
		stats?: { known: string[]; allowedNew: string[]; outside: string[]; coverage: number };
	};
	type Past = { id: number; title: string; params: { style: string; length: string }; createdAt: number };

	const STYLES = [
		['manga', 'Manga'],
		['novela', 'Novela ligera'],
		['cartel', 'Carteles y menús'],
		['juego', 'Videojuego'],
		['web', 'Web / redes'],
		['noticia', 'Noticia']
	] as const;

	let style = $state('manga');
	let length = $state('corto');
	let topic = $state('');
	let reading = $state<Reading | null>(null);
	/** Costo de la última generación (solo para la recién creada). */
	let cost = $state<OperationCost | null>(null);
	let past: Past[] = $state([]);
	let loading = $state(false);
	let showEs: Record<number, boolean> = $state({});
	let allEs = $state(false);
	let picked: Record<number, number> = $state({});

	type Read = { cpm: number; createdAt: number; furigana: string };
	let currentId: number | null = $state(null);
	let reads: Read[] = $state([]);

	async function generate() {
		loading = true;
		try {
			const r = await post<{ id: number; reading: Reading; cost: OperationCost | null }>('/api/reading', { style, length, topic });
			open(r.id, r.reading, []);
			cost = r.cost;
			loadPast();
		} catch (e) {
			toast.error('No se pudo generar la lectura', { detail: errMsg(e) });
		} finally {
			loading = false;
		}
	}

	function open(id: number, r: Reading, prev: Read[]) {
		currentId = id;
		reading = r;
		cost = null;
		reads = prev;
		showEs = {};
		picked = {};
		allEs = false;
	}

	async function openPast(id: number) {
		const r = await get<{ content: Reading; reads: Read[] }>(`/api/reading/${id}`);
		open(id, r.content, r.reads);
	}

	async function loadPast() {
		past = (await get<{ readings: Past[] }>('/api/reading')).readings;
	}

	const plain = (tokens: JpToken[]) => tokens.map((t) => t.s).join('');
	const chars = $derived(reading ? reading.lines.reduce((n, l) => n + plain(l.tokens).length, 0) : 0);
	const answered = $derived(reading ? Object.keys(picked).length : 0);
	const comprehension = $derived(
		reading && reading.questions.length && answered === reading.questions.length
			? reading.questions.filter((q, i) => picked[i] === q.answer_index).length / reading.questions.length
			: null
	);

	$effect(() => {
		if (!reading) return;
		setScreenContext({
			kind: 'reading',
			label: `lectura «${reading.title.slice(0, 30)}»`,
			data: {
				reading_id: currentId,
				title: reading.title,
				lines: reading.lines.map((l) => `${plain(l.tokens)} — ${l.es}`).slice(0, 20),
				new_kanji: reading.stats?.allowedNew ?? []
			}
		});
	});

	onMount(() => {
		loadPast();
		// ?id=N: abrir una lectura concreta (p. ej. relectura sugerida en Inicio).
		const id = Number(new URL(location.href).searchParams.get('id'));
		if (id) openPast(id).catch((e) => toast.error('No se pudo generar la lectura', { detail: errMsg(e) }));
	});
</script>

<svelte:head><title>Lectura graduada · Sensei</title></svelte:head>

<h1>Lectura graduada <HelpLink section="lectura" /></h1>
<p class="muted small">
	Textos originales con casi solo los kanji que ya conoces y 1-2 nuevos. Toca cualquier palabra para ver el diccionario.
</p>

<div class="card form">
	<div>
		<label for="style">Estilo</label>
		<select id="style" bind:value={style}>
			{#each STYLES as [v, l] (v)}<option value={v}>{l}</option>{/each}
		</select>
	</div>
	<div>
		<label for="len">Longitud</label>
		<select id="len" bind:value={length}>
			<option value="corto">Corto</option>
			<option value="medio">Medio</option>
			<option value="largo">Largo</option>
		</select>
	</div>
	<div class="grow">
		<label for="topic">Tema (opcional)</label>
		<input id="topic" bind:value={topic} placeholder="p. ej. un gato que trabaja en una tienda de ramen" />
	</div>
	<button class="primary" onclick={generate} disabled={loading}>
		{#if loading}<span class="spinner"></span> Escribiendo…{:else}Generar{/if}
	</button>
</div>


{#if reading}
	<article class="card stack">
		<div class="spread">
			<h2 class="jp">{reading.title}</h2>
			<div class="row">
				<SpeakButton text={reading.lines.map((l) => plain(l.tokens)).join('。')} label="Escuchar todo" />
				<button class="small" onclick={() => (allEs = !allEs)}>{allEs ? 'Ocultar' : 'Mostrar'} traducción</button>
			</div>
		</div>
		{#if reading.stats}
			<div class="small dim">
				Cobertura de kanji conocidos: {Math.round(reading.stats.coverage * 100)}%
				{#if reading.stats.allowedNew.length}· nuevos: <span class="jp">{reading.stats.allowedNew.join(' ')}</span>{/if}
				{#if reading.stats.outside.length}· fuera de nivel: <span class="jp">{reading.stats.outside.join(' ')}</span>{/if}
			</div>
		{/if}
		{#if currentId}
			{#key currentId}
				<ReadTimer {chars} textKind="graded" textId={currentId} previous={reads} {comprehension} onlogged={(r) => (reads = r.reads)} />
			{/key}
		{/if}

		<div class="text">
			{#each reading.lines as l, i (i)}
				<div class="line">
					{#if l.speaker}<span class="speaker jp">{l.speaker}</span>{/if}
					<div class="jpline">
						<JpTokens tokens={l.tokens} serif />
						<SpeakButton text={plain(l.tokens)} />
						<button class="ghost small" onclick={() => (showEs[i] = !showEs[i])} title="Traducción">ES</button>
						<MineSentence tokens={l.tokens} es={l.es} source="reading" />
					</div>
					{#if allEs || showEs[i]}<div class="es small muted">{l.es}</div>{/if}
				</div>
			{/each}
		</div>
		<CostNote {cost} />
	</article>

	{#if reading.new_words.length}
		<div class="card">
			<h3>Palabras del texto</h3>
			<ul class="words">
				{#each reading.new_words as w (w.word)}
					<li>
						<span class="jp" data-lookup={w.word}>{w.word}</span>
						<span class="jp muted">【{w.reading}】</span>
						<span class="small">{w.es}</span>
						<AddWordButton word={w.word} reading={w.reading} gloss={w.es} />
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if reading.questions.length}
		<div class="card stack">
			<h3>Comprensión</h3>
			{#each reading.questions as q, qi (qi)}
				<div>
					<div>{qi + 1}. {q.q}</div>
					<div class="opts">
						{#each q.options as o, oi (oi)}
							<button
								class:right={picked[qi] !== undefined && oi === q.answer_index}
								class:wrong={picked[qi] === oi && oi !== q.answer_index}
								disabled={picked[qi] !== undefined}
								onclick={() => (picked[qi] = oi)}>{o}</button
							>
						{/each}
					</div>
					{#if picked[qi] !== undefined}<div class="small muted">{q.explanation}</div>{/if}
				</div>
			{/each}
		</div>
	{/if}
{/if}

{#if past.length}
	<details class="card">
		<summary>Lecturas anteriores ({past.length})</summary>
		<ul class="past">
			{#each past as p (p.id)}
				<li>
					<button class="ghost small" onclick={() => openPast(p.id)}>
						<span class="jp">{p.title}</span>
						<span class="dim">· {p.params.style} · {new Date(p.createdAt).toLocaleDateString('es')}</span>
					</button>
				</li>
			{/each}
		</ul>
	</details>
{/if}

<style>
	.form {
		display: flex;
		gap: 0.8rem;
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.form > div {
		min-width: 140px;
	}
	.grow {
		flex: 1;
		min-width: 220px;
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		font-size: 1.35rem;
	}
	.speaker {
		font-size: 0.8rem;
		color: var(--accent-2);
	}
	.jpline {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		flex-wrap: wrap;
	}
	.es {
		font-size: 0.9rem;
	}
	.words {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.35rem;
	}
	.opts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.4rem;
		margin: 0.4rem 0;
	}
	.right {
		border-color: var(--ok);
	}
	.wrong {
		border-color: var(--bad);
	}
	.past {
		list-style: none;
		padding: 0;
	}
</style>
