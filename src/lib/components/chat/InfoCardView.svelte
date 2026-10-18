<script lang="ts">
	// Ficha de kanji / palabra / gramática mostrada por el tutor, con botón «＋ A mi próxima lección».
	import type { InfoCard } from '../../types.ts';
	import { post, errMsg } from '../../client/api.ts';
	import StatusBadge from '../StatusBadge.svelte';
	import SpeakButton from '../SpeakButton.svelte';
	import PromptText from '../PromptText.svelte';
	import Markdown from '../Markdown.svelte';
	import { toast } from '../../client/toast.svelte.ts';

	let { card }: { card: InfoCard } = $props();
	let queued = $state(false);
	let msg = $state('');

	const status = $derived(card.kind === 'kanji' ? card.kanji.status : card.kind === 'word' ? (card.word.status ?? 'none') : card.status);
	const itemKey = $derived(card.kind === 'kanji' ? card.kanji.char : card.kind === 'word' ? card.word.mainForm : card.grammar.id);

	async function queue() {
		try {
			const r = await post<{ type: string }>('/api/queue', { item: itemKey });
			queued = true;
			msg = r.type === 'grammar' ? 'Añadido a tu gramática' : 'En cola para tu próxima lección';
		} catch (e) {
			toast.error('No se pudo añadir a la lección', { detail: errMsg(e) });
		}
	}
</script>

<div class="info card">
	{#if card.kind === 'kanji'}
		{@const k = card.kanji}
		<div class="head">
			<a class="big jp kanji" href="/kanji/{k.char}">{k.char}</a>
			<div>
				<div class="title">{(k.meaningsEs.length ? k.meaningsEs : k.meaningsEn).slice(0, 4).join(', ')}</div>
				<div class="jp small">
					{#if k.onReadings.length}音 {k.onReadings.join('、')}{/if}
					{#if k.kunReadings.length}&nbsp; 訓 {k.kunReadings.join('、')}{/if}
				</div>
				{#if k.components.length}
					<div class="small muted">
						Piezas: {#each k.components as c (c.symbol)}<span class="jp comp" data-lookup={c.symbol}>{c.symbol}</span>{c.nameEs ? ` ${c.nameEs}` : ''} {/each}
					</div>
				{/if}
			</div>
		</div>
		{#if k.mnemonicMeaning}<div class="small mn"><Markdown text={k.mnemonicMeaning} /></div>{/if}
		{#if card.similar.length}
			<div class="small muted">No confundir con: {#each card.similar as x (x.char)}<a class="jp" href="/kanji/{x.char}" title={x.tip ?? x.meaning}>{x.char}</a> {/each}</div>
		{/if}
	{:else if card.kind === 'word'}
		{@const w = card.word}
		<div class="head">
			<span class="big jp word" data-lookup={w.mainForm}>{w.mainForm}</span>
			<div>
				<div class="jp">【{w.kanaForms.slice(0, 2).join('・')}】 <SpeakButton text={w.mainReading} /></div>
				<div class="title">{(w.glossesEs ?? w.glossesEn).slice(0, 4).join('; ')}</div>
			</div>
		</div>
		{#if w.sentences?.length}
			<div class="small ex">
				<span class="jp">{w.sentences[0].jp}</span>
				<div class="muted">{w.sentences[0].es ?? w.sentences[0].en}</div>
			</div>
		{/if}
	{:else}
		{@const g = card.grammar}
		<div class="jp big gram">{g.pattern}</div>
		<div class="title">{g.meaning}</div>
		<div class="small">{g.explanation}</div>
		{#each g.examples.slice(0, 1) as ex, i (i)}
			<div class="small ex"><span class="jp"><PromptText text={ex.jp} highlight={g.pattern} /></span><div class="muted">{ex.es}</div></div>
		{/each}
	{/if}
	<div class="row small foot">
		<StatusBadge {status} />
		{#if status === 'none' && !queued}
			<button class="small" onclick={queue}>{card.kind === 'grammar' ? '＋ Aprender' : '＋ A mi próxima lección'}</button>
		{/if}
		{#if card.kind === 'kanji'}<a class="small" href="/kanji/{card.kanji.char}">Ficha completa</a>{/if}
		{#if msg}<span class="muted">{msg}</span>{/if}
	</div>
</div>

<style>
	.info {
		padding: 0.8rem 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		max-width: 520px;
	}
	.head {
		display: flex;
		gap: 0.8rem;
		align-items: center;
	}
	.big {
		font-size: 2.6rem;
		line-height: 1;
	}
	.kanji {
		color: var(--kanji);
	}
	.word {
		color: var(--vocab);
		font-size: 2rem;
	}
	.gram {
		color: var(--accent-2);
		font-size: 1.6rem;
	}
	.title {
		font-weight: 600;
	}
	.comp {
		margin-left: 0.3rem;
	}
	.mn {
		border-left: 3px solid var(--accent-2);
		padding-left: 0.6rem;
	}
	.ex {
		border-left: 3px solid var(--vocab);
		padding-left: 0.6rem;
	}
	.foot {
		gap: 0.5rem;
	}
</style>
