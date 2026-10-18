<script lang="ts">
	// Enlace «¿Cómo funciona?» a su apartado de la Guía → Cómo funciona por dentro.
	let { part }: { part: 'srs' | 'orden' | 'adaptativos' | 'lectura' } = $props();
</script>

<a class="how small" href="/guia#por-dentro-{part}">¿Cómo funciona?</a>

<style>
	.how {
		color: var(--text-3);
		white-space: nowrap;
	}
	.how:hover {
		color: var(--info);
	}
</style>
