<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import type { PageProps } from './$types';
	import { post, errMsg } from '#lib/client/api.ts';
	import KanjiDetail from '#lib/components/KanjiDetail.svelte';
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
				data: { symbol: data.component.symbol, name: data.component.nameEs, usedIn: data.component.usedIn.slice(0, 10) }
			});
	});
	let busy = $state(false);
	let error = $state('');
	let added = $state(false);

	async function enrich() {
		if (!data.kanji) return;
		busy = true;
		error = '';
		try {
			await post(`/api/kanji/${encodeURIComponent(data.kanji.char)}/enrich`);
			await refreshAll();
		} catch (e) {
			error = errMsg(e);
		} finally {
			busy = false;
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
	let resetMsg = $state('');
	const item = $derived(
		data.kanji ? { type: 'kanji' as const, key: data.kanji.char } : data.component ? { type: 'component' as const, key: data.component.symbol } : null
	);

	async function askReset() {
		if (!item) return;
		error = '';
		try {
			resetInfo = (await post<{ preview: Record<string, number> }>('/api/data/reset', { item, dry: true })).preview;
			resetOpen = true;
		} catch (e) {
			error = errMsg(e);
		}
	}

	async function confirmReset() {
		if (!item) return;
		resetBusy = true;
		try {
			const r = await post<{ backup: string }>('/api/data/reset', { item });
			resetOpen = false;
			resetMsg = `Reiniciado. Copia previa: ${r.backup}`;
			await refreshAll();
		} catch (e) {
			error = errMsg(e);
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
		{#if !data.kanji.mnemonicMeaning}
			<button onclick={enrich} disabled={busy}>
				{#if busy}<span class="spinner"></span>{/if} Generar mnemotecnia
			</button>
		{/if}
		{#if data.kanji.status === 'none'}
			<button onclick={add} disabled={added}>{added ? 'Añadido ✓' : 'Añadir al SRS ahora'}</button>
		{/if}
		<button onclick={() => askTutor(tutor.context, `¿Cómo puedo recordar ${data.kanji?.char} y no confundirlo?`)}>Preguntar al tutor</button>
		{#if data.kanji.status !== 'none'}
			<button class="ghost" onclick={askReset} title="Vuelve a «sin estudiar»: reaparecerá en las lecciones">Reiniciar este kanji…</button>
		{/if}
	</div>
	{#if error}<div class="error small">{error}</div>{/if}
	{#if resetMsg}<div class="card small">{resetMsg}</div>{/if}
{:else if data.component}
	<div class="card stack">
		<div class="row">
			<span class="jp sym">{data.component.symbol}</span>
			<div>
				<div class="name">Componente: {data.component.nameEs ?? '—'}</div>
				{#if data.component.strokes}<div class="dim small">{data.component.strokes} trazos</div>{/if}
			</div>
		</div>
		<div>
			<h3>Aparece en</h3>
			<div class="row jp used">
				{#each data.component.usedIn as u (u)}<a href="/kanji/{u}">{u}</a>{/each}
			</div>
		</div>
		<div><button class="ghost small" onclick={askReset}>Reiniciar este componente…</button></div>
		{#if error}<div class="error small">{error}</div>{/if}
		{#if resetMsg}<div class="small">{resetMsg}</div>{/if}
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
	.sym {
		font-size: 5rem;
		line-height: 1;
		background: var(--component);
		color: #fff;
		border-radius: var(--radius);
		padding: 0.5rem 0.8rem;
	}
	.name {
		font-size: 1.4rem;
	}
	.simk {
		font-size: 1.8rem;
		color: var(--kanji);
	}
	.used {
		font-size: 1.4rem;
	}
</style>
