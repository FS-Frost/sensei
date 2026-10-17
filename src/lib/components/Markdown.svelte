<script lang="ts">
	import { renderMarkdown } from '../client/markdown.ts';
	import { furiganaClass, prefs } from '../client/state.svelte.ts';

	let { text }: { text: string } = $props();
	const html = $derived(renderMarkdown(text, { readable: prefs.readable }));
</script>

<div class="md jp {furiganaClass(prefs.furigana)}">{@html html}</div>
