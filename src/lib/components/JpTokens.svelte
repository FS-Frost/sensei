<script lang="ts">
	import type { FuriganaMode, JpToken } from '../types.ts';
	import { furiganaClass, prefs } from '../client/state.svelte.ts';

	let {
		tokens,
		serif = false,
		forceFurigana = false,
		furigana
	}: { tokens: JpToken[]; serif?: boolean; forceFurigana?: boolean; furigana?: FuriganaMode } = $props();

	const cls = $derived(forceFurigana ? 'show-furigana' : furiganaClass(furigana ?? prefs.furigana));
	const title = (t: JpToken) =>
		t.v === false ? 'Lectura no confirmada por el diccionario' : [t.g, t.x?.length ? `(${t.b}: ${t.x.join(' + ')})` : ''].filter(Boolean).join(' ');
</script>

<span class="tokens {serif ? 'jp-serif' : 'jp'} {cls}"
	>{#each tokens as t, i (i)}{#if t.r}<ruby
				class:known={t.k}
				class:unverified={t.v === false}
				data-lookup={t.b ?? t.s}
				data-b={t.s}
				title={title(t)}
				>{t.s}<rt>{t.r}</rt></ruby
			>{:else if t.p === 'puntuación' || !t.g}{t.s}{:else}<span data-lookup={t.b ?? t.s} data-b={t.s} title={title(t)}
				>{t.s}</span
			>{/if}{/each}</span
>

<style>
	.tokens {
		line-height: 2.1;
	}
</style>
