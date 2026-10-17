<script lang="ts">
	import { speak, ttsSupported } from '../client/tts.ts';
	import { prefs } from '../client/state.svelte.ts';

	let { text, label = 'Escuchar' }: { text: string; label?: string } = $props();
	let supported = $state(false);
	$effect(() => {
		supported = ttsSupported();
	});
</script>

{#if supported && prefs.ttsEnabled}
	<button class="ghost small speak" type="button" title={label} aria-label={label} onclick={() => speak(text)}>🔊</button>
{/if}

<style>
	.speak {
		padding: 0.15rem 0.4rem;
		border-color: transparent;
	}
</style>
