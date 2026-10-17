<script lang="ts">
	import type { ItemStatus } from '../types.ts';

	let { status }: { status: ItemStatus } = $props();
	const LABEL: Record<ItemStatus, string> = {
		none: 'sin estudiar',
		learning: 'aprendiendo',
		review: 'en repaso',
		mastered: 'dominado'
	};
</script>

<span class="badge st-{status}">{LABEL[status]}</span>

<style>
	.st-learning {
		color: var(--warn);
	}
	.st-review {
		color: var(--info);
	}
	.st-mastered {
		color: var(--ok);
	}
</style>
