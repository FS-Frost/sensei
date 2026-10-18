<script lang="ts">
	// Una lectura en kana con romaji pequeño debajo SOLO si tiene algún kana que aún no lees con soltura
	// (prefs.weakKana). A medida que aprendes los kana, el romaji desaparece solo: no es una muleta permanente.
	import { prefs } from '../client/state.svelte.ts';
	import { wordRomaji } from '../kana.ts';

	let { text }: { text: string } = $props();
	const hint = $derived([...text].some((c) => prefs.weakKana.has(c)) ? wordRomaji(text.replace(/[・.\-]/g, ''))[0] : null);
</script>

{#if hint}<ruby class="kh">{text}<rt>{hint}</rt></ruby>{:else}{text}{/if}

<style>
	.kh {
		ruby-position: under;
	}
	.kh rt {
		font-family: var(--font-ui, system-ui, sans-serif);
		font-size: 0.55em;
		color: var(--text-3);
		letter-spacing: 0.02em;
	}
</style>
