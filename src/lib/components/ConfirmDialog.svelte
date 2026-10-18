<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		title,
		word,
		confirmLabel = 'Confirmar',
		danger = true,
		busy = false,
		disabled = false,
		children,
		onconfirm
	}: {
		open?: boolean;
		title: string;
		/** Si se indica, hay que escribirla para habilitar el botón. */
		word?: string;
		confirmLabel?: string;
		danger?: boolean;
		busy?: boolean;
		/** Deshabilita confirmar (p. ej. no hay nada elegido). */
		disabled?: boolean;
		children: Snippet;
		onconfirm: () => void;
	} = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	let typed = $state('');
	const ok = $derived(!disabled && (!word || typed.trim().toUpperCase() === word));

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			typed = '';
			dialog.showModal();
		} else if (!open && dialog.open) dialog.close();
	});
</script>

<dialog bind:this={dialog} onclose={() => (open = false)} class="card">
	<h2>{title}</h2>
	<div class="body">{@render children()}</div>
	{#if word}
		<label for="confirm-word">Escribe <strong>{word}</strong> para continuar</label>
		<input id="confirm-word" bind:value={typed} autocomplete="off" autocapitalize="characters" />
	{/if}
	<div class="row actions">
		<button type="button" onclick={() => (open = false)} disabled={busy}>Cancelar</button>
		<button type="button" class:primary={danger} class:danger onclick={onconfirm} disabled={!ok || busy}>
			{#if busy}<span class="spinner"></span>{/if}
			{confirmLabel}
		</button>
	</div>
</dialog>

<style>
	dialog {
		width: min(560px, calc(100vw - 2rem));
		max-height: calc(100dvh - 2rem);
		overflow-y: auto;
		color: var(--text);
		padding: 1.2rem 1.3rem;
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.5);
	}
	.body {
		margin-bottom: 0.9rem;
		color: var(--text-2);
	}
	.body :global(ul) {
		margin: 0.4rem 0;
		padding-left: 1.2rem;
	}
	.actions {
		justify-content: flex-end;
		margin-top: 0.9rem;
	}
	.danger {
		background: var(--bad);
		border-color: var(--bad);
		color: #fff;
	}
</style>
