<script lang="ts">
	// Barra apilada ordinal (aprendiendo → en repaso → dominado): una rampa azul, gap de 2px, leyenda siempre visible.
	let {
		learning,
		review,
		mastered,
		total,
		label
	}: { learning: number; review: number; mastered: number; total: number; label: string } = $props();

	// Colores de app.css (--ord-1..3): cambian con el tema.
	const all = $derived([
		{ key: 'learning', name: 'Aprendiendo', n: learning, color: 'var(--ord-1)' },
		{ key: 'review', name: 'En repaso', n: review, color: 'var(--ord-2)' },
		{ key: 'mastered', name: 'Dominado', n: mastered, color: 'var(--ord-3)' }
	]);
	const segs = $derived(all.filter((s) => s.n > 0));
	const pct = (n: number) => (total ? (n / total) * 100 : 0);
	const studied = $derived(learning + review + mastered);
</script>

<div class="meter">
	<div class="spread small">
		<span>{label}</span>
		<span class="muted">{studied} / {total}</span>
	</div>
	<div class="track" role="img" aria-label="{label}: {learning} aprendiendo, {review} en repaso, {mastered} dominados de {total}">
		{#each segs as s (s.key)}
			<div class="seg" style="width:{pct(s.n)}%; background:{s.color}" title="{s.name}: {s.n}"></div>
		{/each}
	</div>
	<div class="legend small dim">
		{#each all as l (l.key)}
			<span><i style="background:{l.color}"></i>{l.name} {l.n}</span>
		{/each}
	</div>
</div>

<style>
	.track {
		display: flex;
		gap: 2px;
		height: 10px;
		margin: 0.35rem 0;
		background: var(--bg-3);
		border-radius: 4px;
		overflow: hidden;
	}
	.seg {
		min-width: 3px;
	}
	.legend {
		display: flex;
		gap: 0.9rem;
		flex-wrap: wrap;
	}
	.legend i {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 2px;
		margin-right: 0.3rem;
	}
</style>
