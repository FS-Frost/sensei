<script lang="ts">
	// Lector a pantalla completa para la Biblioteca: paginado (horizontal o vertical, como una novela japonesa) o con
	// scroll, tipografía ajustable, posición guardada (viaja al exportar/sincronizar), marcadores y cronómetro por sesión.
	// Diccionario al tocar (DictPopover) y tutor (話) siguen disponibles encima. Ver docs/reader.md.
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import type { FuriganaMode, JpToken } from '../../types.ts';
	import JpTokens from '../JpTokens.svelte';
	import MineSentence from '../MineSentence.svelte';
	import { post } from '../../client/api.ts';
	import { prefs } from '../../client/state.svelte.ts';
	import { keepAwake } from '../../client/wakeLock.ts';
	import { completeDaily } from '../../client/daily.svelte.ts';
	import { loadReaderPrefs, saveReaderPrefs, readChars, windowAround, type ReaderPrefs } from './reader.ts';

	type Bookmark = { sentence: number; note: string; at: number };
	let {
		textId,
		title,
		sentences,
		start = 0,
		bookmarks = $bindable([]),
		furigana = $bindable(prefs.furigana),
		next = null,
		onclose,
		onlogged
	}: {
		textId: number;
		title: string;
		sentences: JpToken[][];
		start?: number;
		bookmarks?: Bookmark[];
		furigana?: FuriganaMode;
		next?: { id: number; title: string } | null;
		onclose: (position: number) => void;
		onlogged?: () => void;
	} = $props();

	let p = $state<ReaderPrefs>(loadReaderPrefs());
	let showSettings = $state(false);
	let showMarks = $state(false);
	let mining = $state(false);
	let box: HTMLDivElement | undefined = $state();
	let current = $state(untrack(() => Math.min(start, Math.max(0, sentences.length - 1))));
	let maxReached = $state(untrack(() => current));
	let range = $state(untrack(() => windowAround(current, sentences.length)));
	const startedAt = Date.now();
	const startPos = untrack(() => current);
	let ended = false;

	$effect(() => saveReaderPrefs(p));

	// ---------- Posición: la primera frase visible ----------
	const visible = new Set<number>();
	let io: IntersectionObserver | null = null;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;

	function observe() {
		io?.disconnect();
		visible.clear();
		if (!box) return;
		io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					const i = Number((e.target as HTMLElement).dataset.i);
					if (e.isIntersecting) visible.add(i);
					else visible.delete(i);
				}
				if (!visible.size) return;
				current = Math.min(...visible);
				maxReached = Math.max(maxReached, Math.max(...visible));
				clearTimeout(saveTimer);
				saveTimer = setTimeout(savePosition, 1500);
				// Cerca del borde de lo renderizado: mover la ventana (textos muy largos).
				if (current < range[0] + 40 && range[0] > 0) void recenter();
				if (Math.max(...visible) > range[1] - 40 && range[1] < sentences.length) void recenter();
			},
			{ root: box, threshold: 0.01 }
		);
		for (const el of box.querySelectorAll<HTMLElement>('[data-i]')) io.observe(el);
	}

	async function recenter() {
		const r = windowAround(current, sentences.length);
		if (r[0] === range[0] && r[1] === range[1]) return;
		range = r;
		await tick();
		observe();
	}

	function savePosition() {
		void fetch(`/api/library/${textId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ position: current })
		}).catch(() => {});
	}

	// ---------- Páginas ----------
	// Paginado horizontal con columnas CSS: margen PAD a cada lado y hueco 2·PAD entre columnas, así cada página mide
	// exactamente el ancho visible y pasar página es desplazar `boxWidth`. Vertical: desplazar casi un ancho.
	const PAD = 32;
	let boxWidth = $state(600);
	const step = () => (box ? (p.vertical ? box.clientWidth * 0.94 : box.clientWidth) : 0);

	function page(dir: 1 | -1) {
		if (!box) return;
		if (p.mode === 'scroll') {
			if (p.vertical) box.scrollBy({ left: -dir * box.clientWidth * 0.85, behavior: 'smooth' });
			else box.scrollBy({ top: dir * box.clientHeight * 0.85, behavior: 'smooth' });
			return;
		}
		// Vertical (derecha → izquierda): avanzar es ir a la izquierda. Instantáneo, como pasar una hoja (el scroll suave
		// no avanza en contenedores overflow:hidden en algunos navegadores).
		box.scrollLeft += (p.vertical ? -dir : dir) * step();
	}

	async function goTo(i: number) {
		current = Math.max(0, Math.min(sentences.length - 1, i));
		range = windowAround(current, sentences.length);
		await tick();
		const el = box?.querySelector<HTMLElement>(`[data-i="${current}"]`);
		el?.scrollIntoView({ block: 'start', inline: 'start' });
		// Encajar en una página entera (paginado horizontal).
		if (box && p.mode === 'paged' && !p.vertical) box.scrollLeft = Math.round(box.scrollLeft / step()) * step();
		observe();
	}

	function onkey(e: KeyboardEvent) {
		const t = e.target instanceof Element ? e.target : null;
		if (showSettings || t?.closest('input, textarea, select')) return;
		const fwd = p.vertical ? ['ArrowLeft', 'PageDown', ' '] : ['ArrowRight', 'ArrowDown', 'PageDown', ' '];
		const back = p.vertical ? ['ArrowRight', 'PageUp'] : ['ArrowLeft', 'ArrowUp', 'PageUp'];
		if (e.key === 'Escape') return close();
		if (fwd.includes(e.key)) {
			e.preventDefault();
			page(1);
		} else if (back.includes(e.key)) {
			e.preventDefault();
			page(-1);
		}
	}

	// Deslizar para pasar página (sin interferir con tocar una palabra).
	let down: { x: number; y: number; t: number } | null = null;
	function onpointerdown(e: PointerEvent) {
		down = { x: e.clientX, y: e.clientY, t: Date.now() };
	}
	function onpointerup(e: PointerEvent) {
		if (!down || p.mode === 'scroll') return;
		const dx = e.clientX - down.x;
		const dy = e.clientY - down.y;
		if (Date.now() - down.t < 600 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) page(dx < 0 === !p.vertical ? 1 : -1);
		down = null;
	}

	// ---------- Marcadores ----------
	const marked = $derived(new Set(bookmarks.map((b) => b.sentence)));
	async function toggleMark() {
		const i = current;
		bookmarks = marked.has(i) ? bookmarks.filter((b) => b.sentence !== i) : [...bookmarks, { sentence: i, note: '', at: Date.now() }].sort((a, b) => a.sentence - b.sentence);
		await fetch(`/api/library/${textId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookmarks }) });
	}
	const plain = (t: JpToken[]) => t.map((x) => x.s).join('');

	// ---------- Sesión: cronómetro y cierre ----------
	let logged = $state<{ cpm: number; chars: number } | null>(null);
	async function logSession() {
		if (ended) return;
		ended = true;
		const durationMs = Date.now() - startedAt;
		const chars = readChars(sentences, startPos, maxReached);
		// Solo si de verdad se leyó (al menos ~20 s y 30 caracteres).
		if (durationMs < 20_000 || chars < 30) return;
		try {
			await post('/api/reading-log', { textKind: 'library', textId, chars, durationMs, furigana, comprehension: null });
			logged = { chars, cpm: Math.round(chars / (durationMs / 60000)) };
			completeDaily('reading');
			onlogged?.();
		} catch {
			/* sin registro: no bloquea cerrar */
		}
	}

	async function close() {
		clearTimeout(saveTimer);
		savePosition();
		await logSession();
		onclose(current);
	}

	let release: () => void = () => {};
	onMount(() => {
		release = keepAwake();
		document.documentElement.classList.add('reading');
		void goTo(current);
		const ro = new ResizeObserver(() => {
			if (box) boxWidth = box.clientWidth;
			void goTo(current);
		});
		if (box) ro.observe(box);
		return () => ro.disconnect();
	});
	onDestroy(() => {
		io?.disconnect();
		clearTimeout(saveTimer);
		release();
		document.documentElement.classList.remove('reading');
	});

	// Cambiar de modo/orientación/tamaño reposiciona en la frase actual.
	$effect(() => {
		void p.mode;
		void p.vertical;
		void p.size;
		void p.line;
		untrack(() => void tick().then(() => goTo(current)));
	});

	const pct = $derived(sentences.length ? Math.round(((current + 1) / sentences.length) * 100) : 0);
	const atEnd = $derived(maxReached >= sentences.length - 1);
</script>

<svelte:window onkeydown={onkey} />

<div class="reader-overlay" role="dialog" aria-modal="true" aria-label="Lector: {title}">
	<header class="bar">
		<button class="ghost small" onclick={close} title="Salir (Esc)">← Salir</button>
		<span class="title" title={title}>{title}</span>
		<span class="small dim pct">{pct} %</span>
		<button class="ghost small" class:on={marked.has(current)} onclick={toggleMark} title="Marcar esta frase">🔖</button>
		<button class="ghost small" class:on={showMarks} onclick={() => (showMarks = !showMarks)} title="Marcadores">☰</button>
		<button class="ghost small" class:on={mining} onclick={() => (mining = !mining)} title="Guardar frases como tarjetas">＋</button>
		<button class="ghost small" class:on={showSettings} onclick={() => (showSettings = !showSettings)} title="Tipografía y modo">Aa</button>
	</header>

	{#if showSettings}
		<div class="panel card small">
			<label>Tamaño <input type="range" min="1" max="2.2" step="0.05" bind:value={p.size} /> {Math.round(p.size * 100)} %</label>
			<label>Interlineado <input type="range" min="1.6" max="3" step="0.1" bind:value={p.line} /> {p.line.toFixed(1)}</label>
			<div class="row">
				<span>Letra</span>
				<button class="small" class:primary={p.font === 'serif'} onclick={() => (p.font = 'serif')}>明朝 mincho</button>
				<button class="small" class:primary={p.font === 'sans'} onclick={() => (p.font = 'sans')}>ゴシック gótica</button>
			</div>
			<div class="row">
				<span>Dirección</span>
				<button class="small" class:primary={!p.vertical} onclick={() => (p.vertical = false)}>横書き horizontal</button>
				<button class="small" class:primary={p.vertical} onclick={() => (p.vertical = true)}>縦書き vertical</button>
			</div>
			<div class="row">
				<span>Pasar</span>
				<button class="small" class:primary={p.mode === 'paged'} onclick={() => (p.mode = 'paged')}>Páginas</button>
				<button class="small" class:primary={p.mode === 'scroll'} onclick={() => (p.mode = 'scroll')}>Scroll</button>
			</div>
			<label>
				Furigana
				<select bind:value={furigana} style="width:auto">
					<option value="adaptive">adaptativa</option>
					<option value="always">siempre</option>
					<option value="never">oculta</option>
				</select>
			</label>
		</div>
	{/if}

	{#if showMarks}
		<div class="panel card small">
			{#if bookmarks.length}
				<ul class="marks">
					{#each bookmarks as b (b.sentence)}
						<li>
							<button class="ghost small" onclick={() => { showMarks = false; void goTo(b.sentence); }}>
								<span class="jp">{plain(sentences[b.sentence] ?? []).slice(0, 40)}…</span>
								<span class="dim">{Math.round(((b.sentence + 1) / sentences.length) * 100)} %</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="dim">Sin marcadores. Toca 🔖 para marcar la frase actual.</p>
			{/if}
		</div>
	{/if}

	<div
		class="pages"
		role="document"
		aria-label="Texto"
		class:vertical={p.vertical}
		class:paged={p.mode === 'paged'}
		bind:this={box}
		style="--size:{p.size}rem; --line:{p.line}; --pad:{PAD}px; --colw:{boxWidth}px"
		{onpointerdown}
		{onpointerup}
	>
		<div class="flow">
			{#if range[0] > 0}<p class="dim small more">… {range[0]} frases antes</p>{/if}
			{#each sentences.slice(range[0], range[1]) as sent, k (range[0] + k)}
				{@const i = range[0] + k}
				<span class="sent" class:marked={marked.has(i)} data-i={i}><JpTokens tokens={sent} serif={p.font === 'serif'} {furigana} /></span>{#if mining}<MineSentence
						tokens={sent}
						source="library"
					/>{/if}
			{/each}
			{#if atEnd}
				<div class="end">
					<p>終 — Fin{next ? ' del capítulo' : ''}.</p>
					{#if logged}<p class="small">Leíste {logged.chars} caracteres a {logged.cpm} car/min.</p>{/if}
					{#if next}<a class="btn primary small" href="/biblioteca/{next.id}?leer=1" onclick={() => void close()}>Siguiente: {next.title} →</a>{/if}
				</div>
			{/if}
		</div>
	</div>

	{#if p.mode === 'paged'}
		<nav class="turn">
			<button class="ghost" onclick={() => page(p.vertical ? 1 : -1)} aria-label={p.vertical ? 'Página siguiente' : 'Página anterior'}>‹</button>
			<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct}><div style="width:{pct}%"></div></div>
			<button class="ghost" onclick={() => page(p.vertical ? -1 : 1)} aria-label={p.vertical ? 'Página anterior' : 'Página siguiente'}>›</button>
		</nav>
	{/if}
</div>

<style>
	.reader-overlay {
		position: fixed;
		inset: 0;
		z-index: 42; /* sobre la barra inferior (40), bajo el diccionario (50) y el tutor (45) */
		background: var(--bg);
		display: flex;
		flex-direction: column;
	}
	:global(html.reading) {
		overflow: hidden;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid var(--line);
		padding-top: max(0.4rem, env(safe-area-inset-top));
	}
	.title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}
	.bar .on {
		background: var(--bg-3);
	}
	.panel {
		position: absolute;
		top: 3rem;
		right: 0.6rem;
		z-index: 2;
		display: grid;
		gap: 0.5rem;
		max-width: min(360px, calc(100vw - 1.2rem));
		max-height: 70vh;
		overflow: auto;
	}
	.panel label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
	}
	.panel label input[type='range'] {
		flex: 1;
	}
	.marks {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.marks button {
		display: flex;
		justify-content: space-between;
		gap: 0.6rem;
		width: 100%;
		text-align: left;
	}
	.pages {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 1.2rem clamp(1rem, 6vw, 4rem);
		font-size: var(--size);
		line-height: var(--line);
		touch-action: pan-y;
	}
	.pages.paged {
		overflow: hidden;
		padding: 1.2rem 0;
		touch-action: none;
	}
	.pages.paged:not(.vertical) .flow {
		height: 100%;
		column-width: calc(var(--colw) - 2 * var(--pad));
		column-gap: calc(2 * var(--pad));
		column-fill: auto;
		padding: 0 var(--pad);
		box-sizing: border-box;
	}
	.pages.vertical {
		writing-mode: vertical-rl;
		overflow-x: auto;
		overflow-y: hidden;
		touch-action: pan-x;
	}
	.pages.vertical.paged {
		overflow: hidden;
		padding: 1rem 1.5rem;
	}
	.pages.vertical .flow {
		height: 100%;
	}
	.flow {
		white-space: pre-wrap;
		max-width: 46em;
		margin: 0 auto;
	}
	.pages.paged .flow,
	.pages.vertical .flow {
		max-width: none;
	}
	.sent.marked {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
		border-radius: 4px;
	}
	.more {
		font-size: 0.8rem;
	}
	.end {
		margin: 2rem 0;
		text-align: center;
		break-inside: avoid;
		white-space: normal;
	}
	.turn {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		/* A la derecha queda el botón flotante del tutor (話): que no tape «›». */
		padding: 0.3rem 4.6rem 0.3rem 0.6rem;
		padding-bottom: max(0.3rem, env(safe-area-inset-bottom));
		border-top: 1px solid var(--line);
	}
	.turn button {
		font-size: 1.4rem;
		padding: 0.1rem 1rem;
	}
	.progress {
		flex: 1;
		height: 4px;
		background: var(--bg-3);
		border-radius: 999px;
		overflow: hidden;
	}
	.progress div {
		height: 100%;
		background: var(--accent);
	}
</style>
