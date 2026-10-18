<script lang="ts">
	import { onMount } from 'svelte';
	import { closeLookup, lookup, openLookup } from '../client/state.svelte.ts';
	import { get, post, errMsg } from '../client/api.ts';
	import type { ComponentInfo, KanjiInfo, SimilarInfo, VocabInfo } from '../types.ts';
	import SpeakButton from './SpeakButton.svelte';
	import StatusBadge from './StatusBadge.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import { askTutor } from '../client/tutorContext.svelte.ts';
	import { aiUi } from '../client/ai.svelte.ts';

	type Result = { words: VocabInfo[]; kanji: KanjiInfo | null; component: ComponentInfo | null; similar?: SimilarInfo[] };

	let result: Result | null = $state(null);
	let loading = $state(false);
	let error = $state('');
	let added = $state<Record<string, boolean>>({});
	let box: HTMLDivElement | undefined = $state();
	let left = $state(0);
	let top = $state(0);

	const cache = new Map<string, Result>();

	$effect(() => {
		if (!lookup.open) return;
		const key = `${lookup.q}|${lookup.b}`;
		error = '';
		const hit = cache.get(key);
		if (hit) {
			result = hit;
			return;
		}
		loading = true;
		result = null;
		get<Result>(`/api/dict?q=${encodeURIComponent(lookup.q)}&b=${encodeURIComponent(lookup.b)}`)
			.then((r) => {
				cache.set(key, r);
				if (lookup.q + '|' + lookup.b === key) result = r;
			})
			.catch((e) => (error = errMsg(e)))
			.finally(() => (loading = false));
	});

	// Posicionar dentro de la ventana.
	$effect(() => {
		if (!lookup.open || !box) return;
		void result;
		const w = box.offsetWidth;
		const h = box.offsetHeight;
		left = Math.max(8, Math.min(window.innerWidth - w - 8, lookup.x - w / 2));
		top = lookup.y + 6 + h > window.innerHeight ? Math.max(8, lookup.y - h - 40) : lookup.y + 6;
	});

	// Reiniciar una palabra (vuelve a "sin estudiar")
	let resetWord: VocabInfo | null = $state(null);
	let resetOpen = $state(false);
	let resetBusy = $state(false);
	async function confirmReset() {
		if (!resetWord) return;
		resetBusy = true;
		try {
			await post('/api/data/reset', { item: { type: 'vocab', key: resetWord.id } });
			cache.clear();
			if (result) result = { ...result, words: result.words.map((w) => (w.id === resetWord!.id ? { ...w, status: 'none' } : w)) };
			resetOpen = false;
		} catch (e) {
			error = errMsg(e);
		} finally {
			resetBusy = false;
		}
	}

	function ask(w: VocabInfo) {
		closeLookup();
		askTutor(
			{
				kind: 'word',
				label: `palabra ${w.inflection?.surface ?? w.mainForm}`,
				data: {
					word: w.mainForm,
					as_seen: w.inflection?.surface ?? null,
					inflection: w.inflection?.reasons ?? null,
					readings: w.kanaForms,
					meanings: w.glossesEs ?? w.glossesEn,
					status: w.status ?? 'none'
				}
			},
			w.inflection ? `¿Qué forma es ${w.inflection.surface}?` : ''
		);
	}

	async function add(body: Record<string, string>, key: string) {
		try {
			await post('/api/srs/add', body);
			added[key] = true;
		} catch (e) {
			error = errMsg(e);
		}
	}

	onMount(() => {
		const canHover = matchMedia('(hover: hover)').matches;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const target = (e: Event) => (e.target as HTMLElement | null)?.closest?.('[data-lookup]') as HTMLElement | null;
		const open = (el: HTMLElement) =>
			openLookup(el.dataset.lookup ?? el.textContent ?? '', el.dataset.b ?? '', el.getBoundingClientRect());

		const onClick = (e: MouseEvent) => {
			const el = target(e);
			if (el) {
				e.preventDefault();
				open(el);
			} else if (box && !box.contains(e.target as Node)) closeLookup();
		};
		const onOver = (e: MouseEvent) => {
			const el = target(e);
			clearTimeout(timer);
			if (el) timer = setTimeout(() => open(el), 450);
		};
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeLookup();

		document.addEventListener('click', onClick);
		if (canHover) document.addEventListener('mouseover', onOver);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('click', onClick);
			document.removeEventListener('mouseover', onOver);
			document.removeEventListener('keydown', onKey);
		};
	});
</script>

{#if lookup.open}
	<div class="pop card" bind:this={box} style="left:{left}px; top:{top}px" role="dialog" aria-label="Diccionario">
		<button class="ghost small close" onclick={closeLookup} aria-label="Cerrar">✕</button>
		{#if loading}
			<span class="spinner"></span>
		{:else if error}
			<div class="error small">{error}</div>
		{:else if result}
			{#if result.kanji}
				{@const k = result.kanji}
				<div class="row">
					<a href="/kanji/{k.char}" class="big jp">{k.char}</a>
					<div>
						<div>{(k.meaningsEs.length ? k.meaningsEs : k.meaningsEn).slice(0, 4).join(', ')}</div>
						<div class="small muted jp">
							{#if k.onReadings.length}音 {k.onReadings.join('、')}{/if}
							{#if k.kunReadings.length}&nbsp; 訓 {k.kunReadings.join('、')}{/if}
						</div>
						<div class="row small">
							<StatusBadge status={k.status} />
							{#if k.status === 'none'}
								<button class="small" disabled={added[k.char]} onclick={() => add({ kanji: k.char }, k.char)}
									>{added[k.char] ? 'Añadido ✓' : '+ SRS'}</button
								>
							{/if}
						</div>
					</div>
				</div>
			{/if}
			{#if result.similar?.length}
				<div class="small muted similar">
					No confundir con:
					{#each result.similar as x (x.char)}
						<a class="jp" href="/kanji/{x.char}" title={x.tip ?? x.meaning}>{x.char}</a>
					{/each}
				</div>
			{/if}
			{#if result.component}
				<div class="row">
					<span class="big jp">{result.component.symbol}</span>
					<span>Componente: {result.component.nameEs ?? '—'}</span>
				</div>
			{/if}
			{#each result.words as w (w.id)}
				<div class="word">
					<div class="row">
						<span class="jp wf">{w.mainForm}</span>
						<span class="jp muted">【{w.kanaForms.slice(0, 2).join('・')}】</span>
						<SpeakButton text={w.mainReading} />
						{#if w.common}<span class="badge">común</span>{/if}
						{#if aiUi()}<button class="ghost small ask" onclick={() => ask(w)} title="Preguntar al tutor sobre esta palabra">話</button>{/if}
					</div>
					{#if w.inflection}
					<div class="small infl">
						<span class="jp">{w.inflection.surface}</span> = <span class="jp">{w.mainForm}</span> + {w.inflection.reasons.join(' + ')}
					</div>
				{/if}
				<div class="small">{(w.glossesEs ?? w.glossesEn).slice(0, 4).join('; ')}</div>
					<div class="row small">
						{#if w.status}<StatusBadge status={w.status} />{/if}
						{#if !w.status || w.status === 'none'}
							<button class="small" disabled={added[w.id]} onclick={() => add({ vocabId: w.id }, w.id)}
								>{added[w.id] ? 'Añadido ✓' : '+ SRS'}</button
							>
						{:else}
							<button
								class="small ghost"
								title="Vuelve a «sin estudiar» (borra sus tarjetas e historial)"
								onclick={() => {
									resetWord = w;
									resetOpen = true;
								}}>Reiniciar…</button
							>
						{/if}
					</div>
				</div>
			{/each}
			{#if !result.words.length && !result.kanji && !result.component}
				<div class="muted small">Sin resultados para «{lookup.q}».</div>
			{/if}
		{/if}
		<ConfirmDialog bind:open={resetOpen} title="Reiniciar palabra" word="REINICIAR" confirmLabel="Reiniciar" busy={resetBusy} onconfirm={confirmReset}>
			<p>
				<span class="jp">{resetWord?.mainForm}</span> volverá a «sin estudiar»: se borran sus tarjetas, su historial y sus confusiones.
				Antes se crea una copia de seguridad.
			</p>
		</ConfirmDialog>
	</div>
{/if}

<style>
	.pop {
		position: fixed;
		z-index: 50;
		width: min(340px, calc(100vw - 16px));
		max-height: 60vh;
		overflow: auto;
		padding: 0.8rem 0.9rem;
		box-shadow: 0 10px 30px var(--shadow);
	}
	.close {
		position: absolute;
		right: 0.3rem;
		top: 0.3rem;
		border: none;
	}
	.big {
		font-size: 2.4rem;
		line-height: 1;
		color: var(--kanji);
	}
	.word {
		border-top: 1px solid var(--line);
		padding-top: 0.5rem;
		margin-top: 0.5rem;
	}
	.wf {
		font-size: 1.25rem;
	}
	.infl {
		color: var(--accent-2);
	}
	.ask {
		margin-left: auto;
		color: var(--accent);
		font-family: var(--font-jp);
	}
	.similar a {
		font-size: 1.2rem;
		margin-left: 0.3rem;
	}
</style>
