<script lang="ts">
	import { cycleTheme, theme, type ThemeMode } from '../client/theme.svelte.ts';

	let { withLabel = true }: { withLabel?: boolean } = $props();

	const INFO: Record<ThemeMode, { icon: string; label: string; next: string }> = {
		light: { icon: '☀', label: 'Claro', next: 'oscuro' },
		dark: { icon: '☾', label: 'Oscuro', next: 'sistema' },
		system: { icon: '◐', label: 'Sistema', next: 'claro' }
	};
	const info = $derived(INFO[theme.mode]);
</script>

<button
	class="theme ghost"
	type="button"
	onclick={cycleTheme}
	title="Tema: {info.label.toLowerCase()} · clic para {info.next}"
	aria-label="Tema: {info.label}. Cambiar a {info.next}"
>
	<span class="icon" aria-hidden="true">{info.icon}</span>
	{#if withLabel}<span>{info.label}</span>{/if}
</button>

<style>
	.theme {
		justify-content: flex-start;
		gap: 0.7rem;
		color: var(--text-2);
		border-color: transparent;
		padding: 0.5rem 0.6rem;
	}
	.theme:hover {
		color: var(--text);
		background: var(--bg-3);
	}
	.icon {
		width: 1.6rem;
		text-align: center;
		color: var(--accent-2);
	}
</style>
