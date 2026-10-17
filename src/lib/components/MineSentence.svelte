<script lang="ts">
	// «Guardar frase»: crea una tarjeta en contexto con la palabra que elijas de la frase.
	import { post, errMsg } from '../client/api.ts';
	import type { JpToken } from '../types.ts';
	import { hasKanji } from '../jp.ts';

	let { tokens, es = null, source }: { tokens: JpToken[]; es?: string | null; source: string } = $props();

	let open = $state(false);
	let status: 'idle' | 'busy' | 'ok' | 'err' = $state('idle');
	let msg = $state('');
	const candidates = $derived(tokens.filter((t) => hasKanji(t.s)));
	const jp = $derived(tokens.map((t) => t.s).join(''));

	async function save(t: JpToken) {
		status = 'busy';
		try {
			await post('/api/sentences', { jp, es, target: t.s, targetReading: t.r, vocabId: t.id, source });
			status = 'ok';
			msg = `Guardada con «${t.s}»`;
			open = false;
		} catch (e) {
			status = 'err';
			msg = errMsg(e);
		}
	}
</script>

{#if candidates.length}
	<span class="mine">
		{#if status === 'ok'}
			<span class="small muted">✓ {msg}</span>
		{:else}
			<button class="small ghost" onclick={() => (open = !open)} title="Tarjeta de repaso con esta frase como contexto">
				＋ Guardar frase
			</button>
		{/if}
		{#if open}
			<span class="pick small">
				¿Qué palabra quieres repasar en esta frase?
				{#each candidates as t, i (i)}
					<button class="small jp" onclick={() => save(t)} disabled={status === 'busy'}>{t.s}</button>
				{/each}
			</span>
		{/if}
		{#if status === 'err'}<span class="small error">{msg}</span>{/if}
	</span>
{/if}

<style>
	.mine {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		align-items: center;
	}
	.pick {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		align-items: center;
		color: var(--text-2);
	}
</style>
