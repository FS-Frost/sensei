<script lang="ts">
	// Pinta los toasts (client/toast.svelte.ts) arriba y al centro, sobre todo lo demás. Los que se cierran solos muestran
	// una barra de tiempo que se detiene con el ratón o el foco encima.
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { dismiss, pause, resume, toasts, type Toast } from '../client/toast.svelte.ts';

	const ICON: Record<Toast['kind'], string> = { success: '✓', info: 'i', warn: '!', error: '✕' };

	async function act(t: Toast, run: () => void | Promise<void>, keep?: boolean) {
		await run();
		if (!keep) dismiss(t.id);
	}
</script>

<div class="toaster" aria-live="polite">
	{#each toasts.list as t (t.id)}
		<div
			class="toast {t.kind}"
			role={t.kind === 'error' || t.kind === 'warn' ? 'alert' : 'status'}
			in:fly={{ y: -16, duration: 180 }}
			out:fly={{ y: -10, duration: 150 }}
			animate:flip={{ duration: 180 }}
			onmouseenter={() => pause(t.id)}
			onmouseleave={() => resume(t.id)}
			onfocusin={() => pause(t.id)}
			onfocusout={() => resume(t.id)}
		>
			<span class="icon" aria-hidden="true">{ICON[t.kind]}</span>
			<div class="body">
				<div class="msg">{t.message}</div>
				{#if t.detail}<div class="detail">{t.detail}</div>{/if}
				{#if t.actions?.length}
					<div class="actions">
						{#each t.actions as a, i (a.label)}
							<button class="small" class:primary={i === 0} onclick={() => act(t, a.run, a.keep)}>{a.label}</button>
						{/each}
					</div>
				{/if}
			</div>
			{#if !t.persistent}
				<button class="close ghost small" onclick={() => dismiss(t.id)} aria-label="Cerrar">✕</button>
			{/if}
			{#if t.duration != null}<span class="timer" style="animation-duration:{t.duration}ms"></span>{/if}
		</div>
	{/each}
</div>

<style>
	.toaster {
		position: fixed;
		top: max(0.75rem, env(safe-area-inset-top));
		left: 50%;
		transform: translateX(-50%);
		z-index: 70; /* sobre el lector (42), el tutor (45), el diccionario (50) */
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: min(480px, calc(100vw - 1.2rem));
		pointer-events: none;
	}
	.toast {
		pointer-events: auto;
		position: relative;
		overflow: hidden;
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		padding: 0.65rem 0.7rem 0.7rem 0.75rem;
		border-radius: var(--radius);
		background: var(--bg-2);
		border: 1px solid var(--line);
		border-left: 4px solid var(--tone);
		box-shadow: 0 8px 28px rgb(0 0 0 / 0.28);
		font-size: 0.92rem;
	}
	.success {
		--tone: var(--ok);
	}
	.info {
		--tone: var(--info);
	}
	.warn {
		--tone: var(--warn);
	}
	.error {
		--tone: var(--bad);
	}
	.icon {
		flex-shrink: 0;
		width: 1.35rem;
		height: 1.35rem;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font-size: 0.75rem;
		font-weight: 700;
		color: #fff;
		background: var(--tone);
		margin-top: 0.05rem;
	}
	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.msg {
		color: var(--text);
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.detail {
		color: var(--text-2);
		font-size: 0.82rem;
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.2rem;
	}
	.close {
		flex-shrink: 0;
		padding: 0.05rem 0.4rem;
		border: none;
	}
	.timer {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 2px;
		width: 100%;
		background: var(--tone);
		opacity: 0.5;
		transform-origin: left;
		animation-name: shrink;
		animation-timing-function: linear;
		animation-fill-mode: forwards;
	}
	.toast:hover .timer,
	.toast:focus-within .timer {
		animation-play-state: paused;
	}
	@keyframes shrink {
		to {
			transform: scaleX(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.timer {
			display: none;
		}
	}
</style>
