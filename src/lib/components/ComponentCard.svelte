<script lang="ts">
	// Ficha de un componente: qué dibuja, por qué el nombre, qué hace en los kanji, ejemplos con el componente
	// resaltado (KanjiVG) y una comprobación rápida «¿en cuál aparece?». La usan la lección y /kanji/[símbolo].
	import type { ComponentInfo } from '../types.ts';
	import { POSITION_ES } from '../strokes.ts';
	import KanjiHighlight from './KanjiHighlight.svelte';
	import StatusBadge from './StatusBadge.svelte';

	let {
		c,
		inLesson = [],
		ongenerate
	}: {
		c: ComponentInfo;
		/** Kanji de esta misma lección que lo usan («lo vas a usar en…»). */
		inLesson?: string[];
		/** Si se pasa, sin explicación se ofrece generarla. */
		ongenerate?: () => Promise<void>;
	} = $props();

	const symbols = $derived(c.fullForm ? [c.symbol, c.fullForm.char] : [c.symbol]);
	const meaningOf = $derived(new Map(c.examples.map((e) => [e.char, e])));
	// Primero los ejemplos explicados (con su porqué), luego el resto: lo ya estudiado antes que lo nuevo.
	const tiles = $derived.by(() => {
		const noted = (c.explanation?.examples ?? []).map((e) => ({
			char: e.char,
			note: e.note,
			meaning: meaningOf.get(e.char)?.meaning ?? '',
			status: meaningOf.get(e.char)?.status ?? ('none' as const)
		}));
		const seen = new Set(noted.map((e) => e.char));
		const rest = c.examples.filter((e) => !seen.has(e.char)).map((e) => ({ ...e, note: '' }));
		return [...noted, ...rest].slice(0, 6);
	});
	let position = $state<string | null>(null);

	// «¿En cuál aparece?»: uno que lo lleva y tres cercanos en la ruta que no.
	let quiz = $state<{ options: string[]; answer: string } | null>(null);
	let picked = $state<string | null>(null);
	$effect(() => {
		const pool = c.examples.map((e) => e.char);
		picked = null;
		position = null;
		if (!pool.length || c.distractors.length < 3) {
			quiz = null;
			return;
		}
		const answer = pool[Math.floor(Math.random() * Math.min(pool.length, 4))];
		const others = [...c.distractors].sort(() => Math.random() - 0.5).slice(0, 3);
		quiz = { answer, options: [answer, ...others].sort(() => Math.random() - 0.5) };
	});

	let generating = $state(false);
	async function generate() {
		if (!ongenerate) return;
		generating = true;
		try {
			await ongenerate();
		} finally {
			generating = false;
		}
	}
</script>

<div class="cc stack">
	<div class="head">
		<div class="sym jp">{c.symbol}</div>
		<div class="stack tight">
			<div class="name">{c.nameEs ?? '—'}</div>
			<div class="row small dim">
				{#if c.strokes}<span>{c.strokes} trazos</span>{/if}
				{#if position && POSITION_ES[position]}<span>suele ir {POSITION_ES[position]}</span>{/if}
			</div>
			{#if c.fullForm}
				<div class="small">
					Es <a class="jp full" href="/kanji/{c.fullForm.char}">{c.fullForm.char}</a>{#if c.fullForm.meaning}
						«{c.fullForm.meaning}»{/if}, en forma reducida para caber junto a otras piezas.
				</div>
			{/if}
		</div>
	</div>

	{#if c.explanation}
		{@const x = c.explanation}
		<dl class="expl">
			<dt>Qué dibuja</dt>
			<dd>{x.depicts}</dd>
			<dt>Por qué «{c.nameEs ?? c.symbol}»</dt>
			<dd>{x.why}</dd>
			<dt>Qué hace en los kanji</dt>
			<dd>{x.role}</dd>
		</dl>
		<div class="hook small"><strong>Para tus mnemotecnias:</strong> {x.hook}</div>
	{:else}
		<p class="small muted">
			Un componente no es una palabra: es una pieza que se repite dentro de muchos kanji. Ponerle nombre te deja leer un
			kanji nuevo como una pequeña escena («{c.nameEs ?? c.symbol}» + otra pieza) en vez de memorizar trazos sueltos.
		</p>
		{#if ongenerate}
			<div>
				<button class="small" onclick={generate} disabled={generating}>
					{#if generating}<span class="spinner"></span>{/if} Explicar este componente
				</button>
			</div>
		{/if}
	{/if}

	{#if inLesson.length}
		<div class="soon small">
			Lo vas a usar enseguida, en esta lección:
			{#each inLesson as k (k)}<span class="jp soonk">{k}</span>{/each}
		</div>
	{/if}

	{#if tiles.length}
		<div>
			<h3>Dónde aparece</h3>
			<div class="tiles">
				{#each tiles as t, i (t.char)}
					<a class="tile" href="/kanji/{t.char}">
						<span class="glyph"><KanjiHighlight char={t.char} {symbols} onposition={i === 0 ? (p) => (position = p) : undefined} /></span>
						<div class="tile-text">
							<span class="meaning">{t.meaning}</span>
							{#if t.note}<span class="small muted">{t.note}</span>{/if}
							{#if t.status !== 'none'}<span class="small"><StatusBadge status={t.status} /></span>{/if}
						</div>
					</a>
				{/each}
			</div>
			{#if c.usedIn.length > tiles.length}
				<div class="small dim more">También en: <span class="jp">{c.usedIn.filter((u) => !tiles.some((t) => t.char === u)).slice(0, 14).join(' ')}</span></div>
			{/if}
		</div>
	{/if}

	{#if quiz}
		<div class="quiz">
			<div class="small"><strong>Pruébate:</strong> ¿en cuál de estos kanji aparece <span class="jp">{c.symbol}</span>?</div>
			<div class="row">
				{#each quiz.options as o (o)}
					<button
						class="opt jp"
						class:right={picked !== null && o === quiz.answer}
						class:wrong={picked === o && o !== quiz.answer}
						disabled={picked !== null}
						onclick={() => (picked = o)}>{o}</button
					>
				{/each}
			</div>
			{#if picked !== null}
				<div class="small" aria-live="polite">
					{#if picked === quiz.answer}✓ Exacto: está en <span class="jp">{quiz.answer}</span>.{:else}Está en <span class="jp">{quiz.answer}</span>: búscalo resaltado arriba.{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.head {
		display: flex;
		gap: 1.2rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.sym {
		font-size: 6rem;
		line-height: 1;
		background: var(--component);
		color: #fff;
		border-radius: var(--radius);
		padding: 0.6rem 0.9rem;
	}
	.name {
		font-size: 1.5rem;
		font-weight: 600;
	}
	.tight {
		gap: 0.25rem;
	}
	.full {
		font-size: 1.3rem;
		color: var(--kanji);
	}
	.expl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.4rem 1rem;
		margin: 0;
	}
	.expl dt {
		color: var(--text-2);
		font-size: 0.9rem;
	}
	.expl dd {
		margin: 0;
	}
	@media (max-width: 560px) {
		.expl {
			grid-template-columns: 1fr;
		}
		.expl dd {
			margin-bottom: 0.4rem;
		}
	}
	.hook {
		border-left: 3px solid var(--component);
		padding-left: 0.6rem;
	}
	.soon {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.soonk {
		font-size: 1.4rem;
		color: var(--kanji);
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 0.6rem;
	}
	.tile {
		display: flex;
		gap: 0.7rem;
		align-items: center;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 0.5rem;
		color: var(--text);
		text-decoration: none;
	}
	.tile:hover {
		border-color: var(--component);
	}
	.glyph {
		flex: none;
	}
	.tile-text {
		display: grid;
		gap: 0.15rem;
		min-width: 0;
	}
	.meaning {
		font-weight: 600;
	}
	.more {
		margin-top: 0.5rem;
	}
	.quiz {
		display: grid;
		gap: 0.5rem;
		border-top: 1px solid var(--line);
		padding-top: 0.8rem;
	}
	.opt {
		font-size: 1.6rem;
		min-width: 3.2rem;
	}
	.opt.right {
		border-color: var(--ok);
		color: var(--ok);
	}
	.opt.wrong {
		border-color: var(--bad);
		color: var(--bad);
	}
</style>
