<script lang="ts">
	import { post, errMsg } from '../client/api.ts';
	import { toast } from '../client/toast.svelte.ts';

	let { word, base, reading, gloss }: { word: string; base?: string; reading?: string; gloss?: string } = $props();
	let status: 'idle' | 'busy' | 'ok' = $state('idle');

	async function add() {
		status = 'busy';
		try {
			await post('/api/srs/add', { word, base, reading, gloss });
			status = 'ok';
			toast.success(`«${base ?? word}» añadida a tus repasos`, { duration: 2500, key: 'srs-add' });
		} catch (e) {
			status = 'idle';
			toast.error(`No se pudo añadir «${base ?? word}»`, { detail: errMsg(e) });
		}
	}
</script>

<button class="small" onclick={add} disabled={status === 'busy' || status === 'ok'}>
	{status === 'ok' ? '✓ en SRS' : '+ SRS'}
</button>
