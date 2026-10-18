<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import type { PageProps } from './$types';
	import { post, errMsg } from '#lib/client/api.ts';
	import { toast } from '#lib/client/toast.svelte.ts';
	import { goto } from '#lib/client/nav.ts';
	import { aiUi } from '#lib/client/ai.svelte.ts';
	import KanjiDetail from '#lib/components/KanjiDetail.svelte';
	import ComponentCard from '#lib/components/ComponentCard.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import { askTutor, setScreenContext, tutor } from '#lib/client/tutorContext.svelte.ts';

	let { data }: PageProps = $props();

	// Contexto para el tutor (panel lateral).
	$effect(() => {
		const k = data.kanji;
		if (k)
			setScreenContext({
				kind: 'kanji',
				label: `kanji ${k.char} · ficha`,
				data: {
					kanji: k.char,
					meanings: k.meaningsEs.length ? k.meaningsEs : k.meaningsEn,
					on: k.onReadings,
					kun: k.kunReadings,
					components: k.components.map((c) => `${c.symbol}(${c.nameEs ?? '?'})`),
					status: k.status,
					mnemonic: k.mnemonicMeaning,
					similar: data.similar.map((x) => x.char)
				}
			});
		else if (data.component)
			setScreenContext({
				kind: 'component',
				label: `componente ${data.component.symbol}`,
				data: {
					symbol: data.component.symbol,
					name: data.component.nameEs,
					full_form: data.component.fullForm?.char,
					explanation: data.component.explanation,
					usedIn: data.component.usedIn.slice(0, 10)
				}
			});
	});
	let busy = $state(false);
	let added = $state(false);
	// Falta algo que su lección generaría: mnemotecnia, consejos de parecidos o glosas en español.
	const missing = $derived(
		!!data.kanji &&
			(!data.kanji.mnemonicMeaning || data.similar.some((x) => !x.tip) || data.kanji.vocab.slice(0, 4).some((v) => !v.glossesEs))
	);

	async function enrich() {
		if (!data.kanji) return;
		busy = true;
		try {
			await post(`/api/kanji/${encodeURIComponent(data.kanji.char)}/enrich`);
			await refreshAll();
			toast.success('Contenido generado', { detail: 'Queda guardado: no se vuelve a pagar.' });
		} catch (e) {
			toast.error('No se pudo generar', {
				detail: errMsg(e),
				actions: [{ label: 'Ir a Ajustes', run: () => void goto('/ajustes') }]
			});
		} finally {
			busy = false;
		}
	}

	async function explainComponent() {
		if (!data.component) return;
		try {
			await post(`/api/kanji/${encodeURIComponent(data.component.symbol)}/enrich`);
			await refreshAll();
		} catch (e) {
			toast.error('No se pudo explicar el componente', {
				detail: errMsg(e),
				actions: [{ label: 'Ir a Ajustes', run: () => void goto('/ajustes') }]
			});
		}
	}

	async function add() {
		if (!data.kanji) return;
		await post('/api/srs/add', { kanji: data.kanji.char });
		added = true;
		await refreshAll();
	}

	// Reinicio de este ítem (kanji o componente)
	let resetOpen = $state(false);
	let resetBusy = $state(false);
	let resetInfo: Record<string, number> | null = $state(null);
	const item = $derived(
		data.kanji ? { type: 'kanji' as const, key: data.kanji.char } : data.component ? { type: 'component' as const, key: data.component.symbol } : null
	);

	async function askReset() {
		if (!item) return;
		try {
			resetInfo = (await post<{ preview: Record<string, number> }>('/api/data/reset', { item, dry: true })).preview;
			resetOpen = true;
		} catch (e) {
			toast.error(errMsg(e));
		}
	}

	async function confirmReset() {
		if (!item) return;
		resetBusy = true;
		try {
			const r = await post<{ backup: string }>('/api/data/reset', { item });
			resetOpen = false;
			toast.success('Ítem reiniciado', { detail: `Copia previa: ${r.backup}.` });
			await refreshAll();
		} catch (e) {
			toast.error(errMsg(e));
		} finally {
			resetBusy = false;
		}
	}
</script>

<svelte:head><title>{data.kanji?.char ?? data.component?.symbol} · Sensei</title></svelte:head>

<a href="/kanji" class="small">← Mapa de kanji</a>

{#if data.kanji}
	<div class="card">
		<KanjiDetail k={data.kanji} />
	</div>
	{#if data.similar.length}
		<div class="card small stack">
			<h3>No confundir con</h3>
			{#each data.similar as x (x.char)}
				<div class="row">
					<a class="jp simk" href="/kanji/{x.char}">{x.char}</a>
					<span>«{x.meaning}»</span>
					{#if x.tip}<span class="muted">— {x.tip}</span>{/if}
					{#if x.status !== 'none'}<span class="badge">ya estudiado</span>{/if}
				</div>
			{/each}
		</div>
	{/if}
	<div class="row">
		{#if missing && aiUi()}
			<button onclick={enrich} disabled={busy} title="Lo mismo que prepara su lección; solo se genera lo que falta">
				{#if busy}<span class="spinner"></span>{/if}
				{data.kanji.mnemonicMeaning ? 'Completar con el tutor' : 'Generar mnemotecnia y traducciones'}
			</button>
		{/if}
		{#if data.kanji.status === 'none'}
			<button onclick={add} disabled={added}>{added ? 'Añadido ✓' : 'Añadir al SRS ahora'}</button>
		{/if}
		{#if aiUi()}
			<button onclick={() => askTutor(tutor.context, `¿Cómo puedo recordar ${data.kanji?.char} y no confundirlo?`)}>Preguntar al tutor</button>
		{/if}
		{#if data.kanji.status !== 'none'}
			<button class="ghost" onclick={askReset} title="Vuelve a «sin estudiar»: reaparecerá en las lecciones">Reiniciar este kanji…</button>
		{/if}
	</div>
{:else if data.component}
	<div class="card stack">
		<span class="badge component">Componente</span>
		<ComponentCard c={data.component} ongenerate={aiUi() ? explainComponent : undefined} />
		<div class="row">
			{#if aiUi()}
				<button onclick={() => askTutor(tutor.context, `¿Qué representa el componente ${data.component?.symbol} y cómo me ayuda a leer kanji?`)}>Preguntar al tutor</button>
			{/if}
			<button class="ghost small" onclick={askReset}>Reiniciar este componente…</button>
		</div>
	</div>
{/if}

<ConfirmDialog bind:open={resetOpen} title="Reiniciar ítem" word="REINICIAR" confirmLabel="Reiniciar" busy={resetBusy} onconfirm={confirmReset}>
	{#if resetInfo}
		<p>
			Se borrarán {resetInfo.cards} tarjeta(s), {resetInfo.reviews} respuesta(s) del historial y {resetInfo.confusions} confusión(es) de
			<span class="jp">«{item?.key}»</span>. Volverá a aparecer en las lecciones. Las palabras que lo usan no cambian.
		</p>
		<p>Antes se crea una copia de seguridad.</p>
	{/if}
</ConfirmDialog>

<style>
	.simk {
		font-size: 1.8rem;
		color: var(--kanji);
	}
</style>
