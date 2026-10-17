<script lang="ts">
	import { fmtUsd, type OperationCost } from '#lib/cost.ts';

	/** Pie discreto con lo que costó generar algo. */
	let { cost }: { cost: OperationCost | null | undefined } = $props();
</script>

{#if cost}
	<p class="cost small dim">
		<a href="/costos" title="Ver costos">
			≈ {fmtUsd(cost.usd)}{#if cost.unpriced} + llamadas sin precio{/if}
		</a>
		· {cost.calls} {cost.calls === 1 ? 'llamada' : 'llamadas'} a Gemini
	</p>
{/if}

<style>
	.cost {
		margin: 0.4rem 0 0;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.cost a {
		color: inherit;
	}
</style>
