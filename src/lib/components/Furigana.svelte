<script lang="ts">
	import { renderFurigana } from '../client/markdown.ts';
	import { furiganaClass, prefs } from '../client/state.svelte.ts';

	let { text, class: cls = '' }: { text: string; class?: string } = $props();
	const html = $derived(renderFurigana(text, { readable: prefs.readable }));
</script>

<span class="jp {furiganaClass(prefs.furigana)} {cls}">{@html html}</span>
