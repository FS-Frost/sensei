<script lang="ts">
	// Enunciado japonés con furigana ({漢字|かな}) y una parte resaltada (palabra objetivo o patrón gramatical).
	import { renderFurigana } from '../client/markdown.ts';
	import { furiganaClass, prefs } from '../client/state.svelte.ts';
	import type { PromptFont } from '../types.ts';

	let { text, highlight, font = 'gothic' }: { text: string; highlight?: string; font?: PromptFont } = $props();

	/** Candidatos a resaltar: «〜てしまう / 〜ちゃう» → ['てしまう', 'ちゃう']. */
	function pieces(h: string) {
		return h
			.split(/[\/／]|\s+/)
			.map((p) => p.replace(/[〜~]/g, '').replace(/\(.*?\)|（.*?）/g, '').trim())
			.filter((p) => p.length > 0 && /[぀-ヿ㐀-鿿]/.test(p))
			.sort((a, b) => b.length - a.length);
	}

	const html = $derived.by(() => {
		const opts = { readable: prefs.readable };
		if (highlight) {
			for (const p of pieces(highlight)) {
				const i = text.indexOf(p);
				if (i >= 0)
					return (
						renderFurigana(text.slice(0, i), opts) +
						`<mark>${renderFurigana(p, opts)}</mark>` +
						renderFurigana(text.slice(i + p.length), opts)
					);
			}
		}
		return renderFurigana(text, opts);
	});
</script>

<span class="prompt-text f-{font} {furiganaClass(prefs.furigana)}">{@html html}</span>

<style>
	.prompt-text :global(mark) {
		background: color-mix(in srgb, var(--warn) 35%, transparent);
		color: inherit;
		border-radius: 4px;
		padding: 0 0.1em;
	}
</style>
