<script lang="ts" module>
	export type StepState = 'done' | 'now' | 'todo';
</script>

<script lang="ts">
	// Lista de pasos con ✓ / spinner / pendiente y una barra (con porcentaje o animada). La usan la instalación inicial
	// (Setup) y el final de la bienvenida mientras se prepara la primera pantalla.

	let {
		steps,
		note = '',
		progress = null
	}: {
		steps: { label: string; state: StepState }[];
		/** Texto bajo los pasos. */
		note?: string;
		/** 0-1 para una barra con porcentaje; null = barra animada (no se sabe cuánto falta); undefined = sin barra. */
		progress?: number | null | undefined;
	} = $props();
</script>

<ol class="steps" aria-label="Progreso">
	{#each steps as st (st.label)}
		<li class={st.state}>
			<span class="mark" aria-hidden="true">{#if st.state === 'done'}✓{:else if st.state === 'now'}<span class="spinner"></span>{:else}·{/if}</span>
			<span>{st.label}</span>
		</li>
	{/each}
</ol>
{#if note}<p class="small muted note">{note}</p>{/if}
{#if progress === null}
	<div class="bar indeterminate" role="progressbar" aria-label="Cargando"><div></div></div>
{:else if progress !== undefined}
	<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress * 100)}>
		<div style="width:{progress * 100}%"></div>
	</div>
{/if}

<style>
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.45rem;
	}
	.steps li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.mark {
		width: 1.3rem;
		text-align: center;
		flex: none;
	}
	.done {
		color: var(--text-2);
	}
	.done .mark {
		color: var(--ok);
		font-weight: 700;
	}
	.now {
		font-weight: 600;
	}
	.todo {
		color: var(--text-3);
	}
	.note {
		margin: 0;
	}
	.bar {
		height: 8px;
		border-radius: 999px;
		background: var(--bg-3);
		overflow: hidden;
	}
	.bar div {
		height: 100%;
		background: var(--series-1);
		transition: width 0.2s;
	}
	.bar.indeterminate div {
		width: 35%;
		border-radius: 999px;
		animation: slide 1.1s ease-in-out infinite;
	}
	@keyframes slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(290%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bar.indeterminate div {
			animation: none;
			width: 100%;
			opacity: 0.5;
		}
	}
</style>
