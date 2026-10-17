<script lang="ts">
	// Columnas de una sola serie: magnitud por día. Sin leyenda (el título nombra la serie), tooltip por columna,
	// rejilla hairline, extremo superior redondeado 4px, ≤24px de ancho, y tabla accesible.
	let {
		labels,
		values,
		title,
		unit = '',
		height = 160,
		format
	}: {
		labels: string[];
		values: number[];
		title: string;
		unit?: string;
		height?: number;
		/** Valores continuos (p. ej. USD): ejes sin redondear a enteros y este formato en ticks, tooltip y tabla. */
		format?: (n: number) => string;
	} = $props();

	const W = 600;
	// Los ticks con formato (p. ej. «$0.0025») necesitan más margen.
	const PAD = $derived({ top: 12, right: 8, bottom: 22, left: format ? 56 : 34 });
	let hover: number | null = $state(null);

	function niceMax(v: number) {
		if (!format && v <= 4) return 4;
		if (v <= 0) return 1;
		const mag = 10 ** Math.floor(Math.log10(v));
		for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= v) return m * mag;
		return 10 * mag;
	}
	const compact = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(1)}K` : String(n));
	const show = (n: number) => (format ? format(n) : compact(n));

	const max = $derived(niceMax(Math.max(0, ...values)));
	const ticks = $derived([0, max / 2, max].map((t) => (format ? t : Math.round(t))));
	const innerW = $derived(W - PAD.left - PAD.right);
	const innerH = $derived(height - PAD.top - PAD.bottom);
	const band = $derived(innerW / Math.max(1, values.length));
	const barW = $derived(Math.min(24, band * 0.6));
	const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
	const labelEvery = $derived(Math.ceil(values.length / 10));

	function barPath(i: number, v: number) {
		const x = PAD.left + band * i + (band - barW) / 2;
		const top = y(v);
		const base = PAD.top + innerH;
		const r = Math.min(4, barW / 2, base - top);
		if (v <= 0) return '';
		return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${base} Z`;
	}
</script>

<figure class="viz">
	<figcaption class="small muted">{title}</figcaption>
	<div class="plot">
		<svg viewBox="0 0 {W} {height}" role="img" aria-label={title}>
			{#each ticks as t (t)}
				<line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} class="grid" />
				<text x={PAD.left - 6} y={y(t) + 4} class="tick" text-anchor="end">{show(t)}</text>
			{/each}
			{#each values as v, i (i)}
				<path d={barPath(i, v)} class="bar" class:dim={hover !== null && hover !== i} />
				{#if i % labelEvery === 0}
					<text x={PAD.left + band * i + band / 2} y={height - 6} class="tick" text-anchor="middle">{labels[i]}</text>
				{/if}
				<!-- Zona de hover más grande que la marca -->
				<rect
					x={PAD.left + band * i}
					y={PAD.top}
					width={band}
					height={innerH}
					fill="transparent"
					role="presentation"
					onmouseenter={() => (hover = i)}
					onmouseleave={() => (hover = null)}
					ontouchstart={() => (hover = i)}
				/>
			{/each}
		</svg>
		{#if hover !== null}
			<div class="tip small" style="left:{((PAD.left + band * hover + band / 2) / W) * 100}%">
				<strong>{format ? format(values[hover]) : values[hover]}</strong>{unit ? ` ${unit}` : ''} · {labels[hover]}
			</div>
		{/if}
	</div>
	<details class="small">
		<summary class="dim">Ver como tabla</summary>
		<table>
			<tbody>
				{#each values as v, i (i)}
					<tr><td>{labels[i]}</td><td class="num">{format ? format(v) : v}</td></tr>
				{/each}
			</tbody>
		</table>
	</details>
</figure>

<style>
	.viz {
		/* --series-1 viene de app.css (cambia con el tema) */
		margin: 0;
	}
	.plot {
		position: relative;
	}
	svg {
		width: 100%;
		display: block;
		overflow: visible;
	}
	.grid {
		stroke: var(--line);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.tick {
		fill: var(--text-3);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.bar {
		fill: var(--series-1);
		transition: opacity 0.15s;
	}
	.bar.dim {
		opacity: 0.45;
	}
	.tip {
		position: absolute;
		top: -0.4rem;
		transform: translate(-50%, -100%);
		background: var(--bg-3);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 0.2rem 0.5rem;
		white-space: nowrap;
		pointer-events: none;
	}
	table {
		border-collapse: collapse;
		margin-top: 0.3rem;
	}
	td {
		padding: 0.1rem 0.8rem 0.1rem 0;
		color: var(--text-2);
	}
	.num {
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
</style>
