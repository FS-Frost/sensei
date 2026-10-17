<script lang="ts">
	import { post, errMsg } from '../client/api.ts';

	let { word, base, reading, gloss }: { word: string; base?: string; reading?: string; gloss?: string } = $props();
	let status: 'idle' | 'busy' | 'ok' | 'err' = $state('idle');
	let msg = $state('');

	async function add() {
		status = 'busy';
		try {
			await post('/api/srs/add', { word, base, reading, gloss });
			status = 'ok';
		} catch (e) {
			status = 'err';
			msg = errMsg(e);
		}
	}
</script>

<button class="small" onclick={add} disabled={status === 'busy' || status === 'ok'} title={msg}>
	{status === 'ok' ? '✓ en SRS' : status === 'err' ? '⚠' : '+ SRS'}
</button>
