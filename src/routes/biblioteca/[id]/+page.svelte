<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { get, post, errMsg } from '#lib/client/api.ts';
	import type { FuriganaMode, JpToken, TextStats } from '#lib/types.ts';
	import { prefs } from '#lib/client/state.svelte.ts';
	import JpTokens from '#lib/components/JpTokens.svelte';
	import ReadTimer from '#lib/components/ReadTimer.svelte';
	import MineSentence from '#lib/components/MineSentence.svelte';
	import HelpLink from '#lib/components/HelpLink.svelte';
	import { setScreenContext } from '#lib/client/tutorContext.svelte.ts';

	type Read = { cpm: number; createdAt: number; furigana: string };
	type Data = {
		text: { id: number; title: string; origin: string; truncated: boolean };
		tokens: JpToken[];
		stats: TextStats;
		reads: Read[];
		nextReread: number | null;
		queued: number;
	};

	let data: Data | null = $state(null);
	let error = $state('');
	let selected: Record<string, boolean> = $state({});
	let goalDate = $state('');
	let planMsg = $state('');
	let planBusy = $state(false);
	let mining = $state(false);
	let furigana: FuriganaMode = $state(prefs.furigana);
	const rereading = $derived(page.url.searchParams.has('releer'));

	async function load() {
		data = await get<Data>(`/api/library/${page.params.id}`);
		selected = Object.fromEntries(data.stats.plan.words.map((w) => [w, true]));
		// En relectura se propone leer con menos ayuda.
		if (rereading && furigana === 'always') furigana = 'adaptive';
	}

	const pct = (x: number) => `${Math.round(x * 100)}%`;
	const chosen = $derived(Object.entries(selected).filter(([, v]) => v).map(([k]) => k));

	/** Agrupa tokens en frases (para «guardar frase»). */
	$effect(() => {
		if (!data) return;
		const st = data.stats;
		setScreenContext({
			kind: 'library',
			label: `texto «${data.text.title.slice(0, 30)}»`,
			data: {
				library_text_id: data.text.id,
				title: data.text.title,
				start: data.tokens.map((t) => t.s).join('').slice(0, 600),
				word_coverage: Math.round(st.wordCoverage * 100),
				kanji_coverage: Math.round(st.kanjiCoverage * 100),
				top_unknown_words: st.unknownWords.slice(0, 10).map((w) => `${w.form}【${w.reading}】`),
				reads: data.reads.map((r) => Math.round(r.cpm))
			}
		});
	});

	const sentences = $derived.by(() => {
		if (!data) return [];
		const out: JpToken[][] = [];
		let cur: JpToken[] = [];
		for (const t of data.tokens) {
			cur.push(t);
			if (/[。！？!?\n]/.test(t.s)) {
				out.push(cur);
				cur = [];
			}
		}
		if (cur.length) out.push(cur);
		return out;
	});

	async function plan(withGoal: boolean) {
		planBusy = true;
		planMsg = '';
		try {
			const r = await post<{ queuedWords: number; queuedKanji: number; goal: { date: string } | null }>(
				`/api/library/${page.params.id}/plan`,
				{ words: chosen, goalDate: withGoal ? goalDate : undefined }
			);
			planMsg =
				`En cola: ${r.queuedWords} palabra(s) y ${r.queuedKanji} kanji. Entrarán primero en tus lecciones.` +
				(r.goal ? ` Objetivo creado para el ${new Date(r.goal.date).toLocaleDateString('es')}: lo verás en Inicio.` : '');
		} catch (e) {
			planMsg = errMsg(e);
		} finally {
			planBusy = false;
		}
	}

	onMount(() => {
		load().catch((e) => (error = errMsg(e)));
	});
</script>

<svelte:head><title>{data?.text.title ?? 'Texto'} · Sensei</title></svelte:head>

<a href="/biblioteca" class="small">← Biblioteca</a>

{#if error}
	<div class="error">{error}</div>
{:else if !data}
	<span class="spinner"></span>
{:else}
	{@const st = data.stats}
	<h1>{data.text.title} <HelpLink section="biblioteca" /></h1>
	{#if data.text.truncated}<div class="warning small">Texto muy largo: se analizan los primeros {st.chars} caracteres.</div>{/if}
	{#if rereading}
		<div class="card small">
			🔁 <strong>Relectura.</strong> Releer un texto conocido entrena la fluidez. Prueba con menos furigana y compara tu velocidad.
		</div>
	{/if}

	<div class="tiles">
		<div class="card tile"><span class="small muted">Palabras que ya repasas</span><span class="value">{pct(st.wordCoverage)}</span></div>
		<div class="card tile"><span class="small muted">Kanji que conoces</span><span class="value">{pct(st.kanjiCoverage)}</span></div>
		<div class="card tile"><span class="small muted">Palabras de contenido</span><span class="value">{st.contentWords}</span></div>
		<div class="card tile"><span class="small muted">Kanji nuevos</span><span class="value">{st.unknownKanji.length}</span></div>
	</div>

	{#if st.unknownWords.length}
		<div class="card stack">
			<h2>Plan antes de leer</h2>
			<p class="small muted">
				Estas palabras son las que más aparecen y aún no repasas. Estudiándolas primero, la cobertura sube de
				<strong>{pct(st.wordCoverage)}</strong> a <strong>{pct(st.plan.coverageAfter)}</strong>. Sus kanji entran con ellas (con sus componentes).
			</p>
			<div class="chips">
				{#each st.unknownWords.slice(0, 40) as w (w.id)}
					<label class="chip" class:on={selected[w.id]} title="{w.reading} — {w.gloss} ({w.count}×)">
						<input type="checkbox" bind:checked={selected[w.id]} />
						<span class="jp">{w.form}</span> <span class="dim">{w.count}×</span>
					</label>
				{/each}
			</div>
			<div class="row">
				<button class="primary" onclick={() => plan(false)} disabled={planBusy || !chosen.length}>
					Poner {chosen.length} en mi cola de lecciones
				</button>
			</div>
			<div class="row small">
				<span>Quiero poder leerlo entero para el</span>
				<input type="date" bind:value={goalDate} style="width:auto" />
				<button onclick={() => plan(true)} disabled={planBusy || !goalDate}>Crear objetivo</button>
				<span class="dim">(todos sus kanji a la cola + objetivo con fecha en Inicio)</span>
			</div>
			{#if data.queued}<div class="small muted">Ya hay {data.queued} ítem(s) de este texto en cola.</div>{/if}
			{#if planMsg}<div class="small">{planMsg}</div>{/if}
		</div>
	{/if}

	<div class="row toolbar">
		<ReadTimer chars={st.chars} textKind="library" textId={data.text.id} previous={data.reads} onlogged={(r) => data && (data.reads = r.reads)} />
		<label class="small">Furigana
			<select bind:value={furigana} style="width:auto">
				<option value="adaptive">adaptativa</option>
				<option value="always">siempre</option>
				<option value="never">oculta</option>
			</select>
		</label>
		<button class="small" class:on={mining} onclick={() => (mining = !mining)}>＋ Guardar frases</button>
	</div>

	<article class="card reader">
		{#each sentences as sent, i (i)}
			<span class="sent"><JpTokens tokens={sent} serif {furigana} /></span>{#if mining}<MineSentence tokens={sent} source="library" />{/if}
		{/each}
	</article>

	{#if st.unknownKanji.length}
		<div class="card">
			<h3>Kanji del texto que aún no conoces ({st.unknownKanji.length})</h3>
			<div class="row jp kanji">
				{#each st.unknownKanji.slice(0, 80) as k (k.char)}
					<a href="/kanji/{k.char}" title="{k.meaning} · {k.count}×">{k.char}</a>
				{/each}
			</div>
		</div>
	{/if}
{/if}

<style>
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 0.8rem;
	}
	.tile {
		display: flex;
		flex-direction: column;
	}
	.value {
		font-size: 1.5rem;
		font-weight: 600;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 0.15rem 0.6rem;
		margin: 0;
		color: var(--text);
		cursor: pointer;
	}
	.chip input {
		width: auto;
		margin: 0;
	}
	.chip.on {
		border-color: var(--accent);
	}
	.toolbar {
		align-items: center;
	}
	.toolbar label {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		margin: 0;
	}
	.on {
		border-color: var(--info);
	}
	.reader {
		font-size: 1.3rem;
		white-space: pre-wrap;
		line-height: 2.2;
	}
	.kanji a {
		font-size: 1.4rem;
	}
</style>
