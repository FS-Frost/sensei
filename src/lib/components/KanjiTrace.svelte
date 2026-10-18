<script lang="ts">
	// Trazar un kanji con el dedo/ratón, trazo a trazo, con corrección local contra KanjiVG.
	// Modos: «guiado» (silueta de fondo) o «de memoria». Un trazo correcto se sustituye por su forma limpia; tras 2 fallos
	// en el mismo trazo se muestra la pista animada. Ver docs/kanji-writing.md.
	import { onMount } from 'svelte';
	import { bestMatch, matchStroke, parseKanjiVG, pathPoints, REASON_ES, type Pt } from '../strokes.ts';

	let {
		char,
		guided = true,
		size = 280,
		onfinish
	}: {
		char: string;
		guided?: boolean;
		size?: number;
		/** Al completar todos los trazos: fallos totales y trazos. */
		onfinish?: (r: { mistakes: number; strokes: number }) => void;
	} = $props();

	let paths: string[] = $state([]);
	let expected: Pt[][] = [];
	let doneCount = $state(0);
	let mistakes = $state(0);
	let failsHere = $state(0);
	let msg = $state('');
	let bad = $state(false);
	let hint = $state(false);
	let error = $state('');
	let drawing: Pt[] = $state([]);
	let svg: SVGSVGElement | undefined = $state();
	let finished = $state(false);

	async function load() {
		error = '';
		try {
			const res = await fetch(`/api/kanjivg/${encodeURIComponent(char)}`);
			if (!res.ok) throw new Error('Sin datos de trazos para este carácter.');
			paths = parseKanjiVG(await res.text());
			expected = paths.map((d) => pathPoints(d));
			reset();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	export function reset() {
		doneCount = 0;
		mistakes = 0;
		failsHere = 0;
		msg = '';
		hint = false;
		finished = false;
		drawing = [];
	}

	function toBox(e: PointerEvent): Pt {
		const r = svg!.getBoundingClientRect();
		return { x: ((e.clientX - r.left) / r.width) * 109, y: ((e.clientY - r.top) / r.height) * 109 };
	}

	function down(e: PointerEvent) {
		if (finished || !paths.length) return;
		svg?.setPointerCapture(e.pointerId);
		drawing = [toBox(e)];
		bad = false;
	}
	function move(e: PointerEvent) {
		if (!drawing.length) return;
		const p = toBox(e);
		const last = drawing[drawing.length - 1];
		if (Math.hypot(p.x - last.x, p.y - last.y) > 0.8) drawing = [...drawing, p];
	}
	function up() {
		if (!drawing.length) return;
		const stroke = drawing;
		drawing = [];
		const v = matchStroke(stroke, expected[doneCount]);
		if (v.ok) {
			doneCount++;
			failsHere = 0;
			hint = false;
			msg = '';
			if (doneCount === paths.length) {
				finished = true;
				msg = mistakes ? `Completo, con ${mistakes} fallo${mistakes === 1 ? '' : 's'}.` : '¡Perfecto! ✓';
				onfinish?.({ mistakes, strokes: paths.length });
			}
			return;
		}
		mistakes++;
		failsHere++;
		const later = bestMatch(stroke, expected.slice(doneCount + 1));
		msg = REASON_ES[later >= 0 ? 'order' : v.reason];
		bad = true;
		setTimeout(() => (bad = false), 450);
		if (failsHere >= 2) hint = true;
	}

	onMount(load);
	const toD = (pts: Pt[]) => (pts.length ? `M${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}` : '');
</script>

<div class="trace">
	{#if error}
		<p class="small dim">{error}</p>
	{:else}
		<svg
			bind:this={svg}
			viewBox="0 0 109 109"
			width={size}
			height={size}
			class:bad
			role="img"
			aria-label="Lienzo para trazar {char}"
			onpointerdown={down}
			onpointermove={move}
			onpointerup={up}
			onpointercancel={up}
		>
			<!-- Cuadrícula de práctica (cruz punteada) -->
			<line x1="54.5" y1="0" x2="54.5" y2="109" class="grid" />
			<line x1="0" y1="54.5" x2="109" y2="54.5" class="grid" />
			{#if guided}
				{#each paths as d, i (i)}<path {d} class="ghost" />{/each}
			{/if}
			{#each paths.slice(0, doneCount) as d, i (i)}<path {d} class="done" />{/each}
			{#if hint && paths[doneCount]}
				{#key failsHere}<path d={paths[doneCount]} class="hint" pathLength="1" />{/key}
			{/if}
			{#if drawing.length}<path d={toD(drawing)} class="ink" />{/if}
		</svg>
		<div class="row small status">
			<span>{doneCount} / {paths.length} trazos</span>
			{#if msg}<span class:warn-text={!finished} class:ok-text={finished}>{msg}</span>{/if}
			<span class="grow"></span>
			{#if !finished && doneCount < paths.length}
				<button class="ghost small" onclick={() => (hint = true)} title="Ver cómo va el siguiente trazo">Pista</button>
			{/if}
			<button class="ghost small" onclick={reset}>Otra vez</button>
		</div>
	{/if}
</div>

<style>
	.trace {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
	}
	svg {
		touch-action: none;
		background: var(--bg-2);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		cursor: crosshair;
		max-width: 100%;
		height: auto;
	}
	svg.bad {
		animation: shake 0.4s;
		border-color: var(--bad);
	}
	.grid {
		stroke: var(--line);
		stroke-width: 0.5;
		stroke-dasharray: 2 2;
	}
	path {
		fill: none;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.ghost {
		stroke: var(--text-3);
		opacity: 0.25;
		stroke-width: 3;
	}
	.done {
		stroke: var(--text);
		stroke-width: 3.5;
	}
	.ink {
		stroke: var(--accent);
		stroke-width: 3.5;
	}
	.hint {
		stroke: var(--info);
		stroke-width: 3.5;
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
		animation: draw 1s ease forwards;
	}
	.status {
		width: 100%;
		max-width: 340px;
		align-items: center;
	}
	.grow {
		flex: 1;
	}
	.warn-text {
		color: var(--warn);
	}
	.ok-text {
		color: var(--ok);
	}
	@keyframes draw {
		to {
			stroke-dashoffset: 0;
		}
	}
	@keyframes shake {
		25% {
			transform: translateX(-4px);
		}
		75% {
			transform: translateX(4px);
		}
	}
</style>
