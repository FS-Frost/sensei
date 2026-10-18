<script lang="ts">
	// Comprobante (acción directa, con «Deshacer») o propuesta (con «Confirmar» / «Rechazar»).
	import { post, errMsg } from '../../client/api.ts';
	import { toast } from '../../client/toast.svelte.ts';
	import type { ActionStatus } from '../../types.ts';

	let {
		actionId,
		label,
		kind,
		status: initial,
		undoable = true,
		onchange
	}: {
		actionId: number;
		label: string;
		kind: 'direct' | 'confirm';
		status: ActionStatus;
		undoable?: boolean;
		onchange?: () => void;
	} = $props();

	let status: ActionStatus = $state('done');
	$effect.pre(() => {
		status = initial;
	});
	let canUndo = $state(true);
	$effect.pre(() => {
		canUndo = undoable;
	});
	let busy = $state(false);
	let result: Record<string, unknown> | null = $state(null);

	async function op(o: 'confirm' | 'reject' | 'undo') {
		busy = true;
		try {
			const r = await post<{ status: ActionStatus; result: Record<string, unknown> | null; undoable: boolean }>(
				`/api/tutor/actions/${actionId}`,
				{ op: o }
			);
			status = r.status;
			result = r.result;
			canUndo = r.undoable;
			onchange?.();
		} catch (e) {
			toast.error(o === 'undo' ? 'No se pudo deshacer' : o === 'confirm' ? 'No se pudo confirmar' : 'No se pudo rechazar', { detail: errMsg(e) });
		} finally {
			busy = false;
		}
	}

	const ICON: Record<ActionStatus, string> = { done: '✓', confirmed: '✓', proposed: '?', rejected: '✕', undone: '↶', failed: '⚠' };
	const TEXT: Record<ActionStatus, string> = {
		done: '',
		confirmed: 'Confirmado',
		proposed: 'Propuesta del tutor',
		rejected: 'Rechazado',
		undone: 'Deshecho',
		failed: 'Falló'
	};
</script>

<div class="action st-{status}" class:proposal={kind === 'confirm'}>
	<span class="icon">{ICON[status]}</span>
	<div class="body">
		{#if TEXT[status]}<div class="small muted">{TEXT[status]}</div>{/if}
		<div class:strike={status === 'undone' || status === 'rejected'}>{label}</div>
		{#if status === 'failed' && result?.error}<div class="small error">{String(result.error)}</div>{/if}
		{#if result?.href}<a class="small" href={String(result.href)}>Abrir</a>{/if}
		{#if result?.backup}<div class="small dim">Copia previa: {String(result.backup)}</div>{/if}
	</div>
	<div class="ops">
		{#if status === 'proposed'}
			<button class="small primary" onclick={() => op('confirm')} disabled={busy}>Confirmar</button>
			<button class="small" onclick={() => op('reject')} disabled={busy}>Rechazar</button>
		{:else if (status === 'done' || status === 'confirmed') && canUndo}
			<button class="small ghost" onclick={() => op('undo')} disabled={busy}>Deshacer</button>
		{/if}
		{#if busy}<span class="spinner"></span>{/if}
	</div>
</div>

<style>
	.action {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		border: 1px solid var(--line);
		border-left: 3px solid var(--ok);
		border-radius: var(--radius-sm);
		padding: 0.5rem 0.7rem;
		background: var(--bg-2);
		font-size: 0.92rem;
	}
	.proposal.st-proposed {
		border-left-color: var(--warn);
	}
	.st-rejected,
	.st-undone {
		border-left-color: var(--text-3);
		opacity: 0.75;
	}
	.st-failed {
		border-left-color: var(--bad);
	}
	.icon {
		font-weight: 700;
		width: 1.1rem;
		text-align: center;
	}
	.body {
		flex: 1;
	}
	.strike {
		text-decoration: line-through;
	}
	.ops {
		display: flex;
		gap: 0.3rem;
		align-items: center;
		flex-wrap: wrap;
	}
</style>
