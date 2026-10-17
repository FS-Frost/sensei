<script lang="ts">
	// Botón «?» que abre la sección correspondiente de la guía.
	let { section, label = 'Ayuda' }: { section: string; label?: string } = $props();
</script>

<a class="help" href="/guia#{section}" title="{label}: cómo funciona esta pantalla" aria-label="{label}: cómo funciona esta pantalla">?</a>

<style>
	.help {
		display: inline-grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 50%;
		border: 1px solid var(--line);
		color: var(--text-2);
		font-size: 0.85rem;
		font-weight: 600;
		vertical-align: middle;
		margin-left: 0.4rem;
	}
	.help:hover {
		text-decoration: none;
		border-color: var(--info);
		color: var(--info);
	}
</style>
