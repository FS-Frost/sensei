<script lang="ts">
	// Un kanji dibujado con los trazos de KanjiVG, con los de un componente en color. Sin datos, el carácter tal cual.
	import { kanjiSvg } from '../client/kanjivg.ts';
	import { componentStrokes } from '../strokes.ts';

	let {
		char,
		symbols,
		size = 72,
		onposition
	}: { char: string; symbols: string[]; size?: number; onposition?: (p: string | null) => void } = $props();

	let parsed = $state<ReturnType<typeof componentStrokes> | null>(null);
	$effect(() => {
		const ch = char;
		const want = symbols;
		parsed = null;
		void kanjiSvg(ch).then((svg) => {
			if (ch !== char || !svg) return;
			parsed = componentStrokes(svg, want);
			onposition?.(parsed.position);
		});
	});
	const any = $derived(parsed?.paths.some((p) => p.on) ?? false);
</script>

{#if parsed && parsed.paths.length}
	<!-- Si KanjiVG no agrupa el componente (trazos sueltos como 丶), se dibuja entero sin atenuar. -->
	<svg viewBox="0 0 109 109" width={size} height={size} class:flat={!any} role="img" aria-label="{char}{any ? `, con el componente ${symbols[0]} resaltado` : ''}">
		{#each parsed.paths as p, i (i)}
			<path d={p.d} class:on={p.on} />
		{/each}
	</svg>
{:else}
	<span class="jp plain" style="font-size:{size * 0.8}px">{char}</span>
{/if}

<style>
	svg {
		display: block;
	}
	path {
		fill: none;
		stroke: var(--text-3);
		stroke-width: 4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.flat path {
		stroke: var(--text);
	}
	path.on {
		stroke: var(--component);
		stroke-width: 5;
	}
	.plain {
		display: block;
		line-height: 1;
	}
</style>
