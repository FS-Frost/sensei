<script lang="ts">
	import type { KanjiInfo } from '../types.ts';
	import Markdown from './Markdown.svelte';
	import SpeakButton from './SpeakButton.svelte';
	import StatusBadge from './StatusBadge.svelte';
	import KanjiTrace from './KanjiTrace.svelte';

	let { k, compact = false }: { k: KanjiInfo; compact?: boolean } = $props();
	let showStrokes = $state(false);
	// «#escribir» (desde «Tarjetas que se resisten») abre la práctica directamente.
	let practice = $state<'guided' | 'memory' | null>(typeof location !== 'undefined' && location.hash === '#escribir' ? 'guided' : null);
	let practiceMsg = $state('');
	const meanings = $derived(k.meaningsEs.length ? k.meaningsEs : k.meaningsEn);

	// La API la atiende el Worker: <img src> no pasa por él, así que se pide con fetch y se muestra como blob.
	async function strokesUrl(ch: string) {
		const res = await fetch(`/api/kanjivg/${encodeURIComponent(ch)}`);
		return res.ok ? URL.createObjectURL(await res.blob()) : null;
	}
</script>

<div class="kd">
	<div class="head">
		<div class="char jp">{k.char}</div>
		<div class="stack">
			<div class="meaning">{meanings.slice(0, 5).join(', ')}</div>
			<div class="readings jp">
				{#if k.onReadings.length}
					<div><span class="tag">音 on</span> {k.onReadings.join('、')} <SpeakButton text={k.onReadings[0]} /></div>
				{/if}
				{#if k.kunReadings.length}
					<div><span class="tag">訓 kun</span> {k.kunReadings.join('、')}</div>
				{/if}
			</div>
			<div class="row small dim">
				<StatusBadge status={k.status} />
				{#if k.strokes}<span>{k.strokes} trazos</span>{/if}
				{#if k.grade}<span>grado {k.grade}</span>{/if}
				{#if k.freq}<span>frecuencia #{k.freq}</span>{/if}
			</div>
		</div>
	</div>

	{#if k.components.length}
		<div>
			<h3>Componentes</h3>
			<div class="row">
				{#each k.components as c (c.symbol)}
					<a class="comp" href={c.isKanji ? `/kanji/${c.symbol}` : undefined} data-lookup={c.isKanji ? undefined : c.symbol}>
						<span class="jp sym">{c.symbol}</span>
						<span class="small">{c.nameEs ?? '?'}</span>
					</a>
				{/each}
			</div>
		</div>
	{/if}

	{#if k.mnemonicMeaning || k.mnemonicReading}
		<div class="mn stack">
			{#if k.mnemonicMeaning}<div><h3>Mnemotecnia · significado</h3><Markdown text={k.mnemonicMeaning} /></div>{/if}
			{#if k.mnemonicReading}<div><h3>Mnemotecnia · lectura</h3><Markdown text={k.mnemonicReading} /></div>{/if}
		</div>
	{/if}

	{#if k.vocab.length}
		<div>
			<h3>Vocabulario</h3>
			<ul class="vocab">
				{#each k.vocab as v (v.id)}
					<li>
						<span class="jp vf" data-lookup={v.mainForm}>{v.mainForm}</span>
						<span class="jp muted">【{v.mainReading}】</span>
						<span class="small">{(v.glossesEs ?? v.glossesEn).slice(0, 3).join('; ')}</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if !compact}
		<div>
			<button class="small" onclick={() => (showStrokes = !showStrokes)}>{showStrokes ? 'Ocultar' : 'Ver'} orden de trazos</button>
			<button class="small" onclick={() => (practice = practice ? null : 'guided')}>✍ {practice ? 'Cerrar práctica' : 'Practicar escritura'}</button>
			{#if practice}
				<div class="practice stack">
					<div class="row small">
						<button class="small" class:primary={practice === 'guided'} onclick={() => (practice = 'guided')}>Con silueta</button>
						<button class="small" class:primary={practice === 'memory'} onclick={() => (practice = 'memory')}>De memoria</button>
						<span class="dim">Traza cada trazo en orden y en su dirección.</span>
					</div>
					{#key practice}
						<KanjiTrace
							char={k.char}
							guided={practice === 'guided'}
							onfinish={(r) => {
								if (practice === 'guided' && r.mistakes === 0) practiceMsg = '¡Sin fallos! Prueba ahora de memoria.';
								else practiceMsg = '';
							}}
						/>
					{/key}
					{#if practiceMsg}<p class="small ok-text">{practiceMsg}</p>{/if}
				</div>
			{/if}
			{#if showStrokes}
				{#await strokesUrl(k.char)}
					<p class="dim small"><span class="spinner"></span> Cargando trazos…</p>
				{:then url}
					{#if url}<img class="strokes" src={url} alt="Orden de trazos de {k.char}" />{:else}<p class="dim small">Sin datos de trazos.</p>{/if}
				{/await}
				<div class="dim small">Trazos: KanjiVG (CC-BY-SA)</div>
			{/if}
		</div>
		{#if k.usedIn.length}
			<div>
				<h3>Aparece en</h3>
				<div class="row jp used">
					{#each k.usedIn as u (u)}<a href="/kanji/{u}">{u}</a>{/each}
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.kd {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
	}
	.head {
		display: flex;
		gap: 1.2rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.char {
		font-size: 6rem;
		line-height: 1;
		background: var(--kanji);
		color: #fff;
		border-radius: var(--radius);
		padding: 0.6rem 0.9rem;
	}
	.meaning {
		font-size: 1.35rem;
		font-weight: 600;
	}
	.readings {
		font-size: 1.1rem;
	}
	.tag {
		font-size: 0.75rem;
		color: var(--text-3);
		font-family: var(--font);
		margin-right: 0.3rem;
	}
	.comp {
		display: flex;
		flex-direction: column;
		align-items: center;
		background: color-mix(in srgb, var(--component) 18%, var(--bg-2));
		border: 1px solid color-mix(in srgb, var(--component) 40%, transparent);
		border-radius: var(--radius-sm);
		padding: 0.3rem 0.7rem;
		color: var(--text);
		min-width: 4.5rem;
	}
	.sym {
		font-size: 1.6rem;
	}
	.mn {
		border-left: 3px solid var(--accent-2);
		padding-left: 0.9rem;
	}
	.vocab {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.3rem;
	}
	.vf {
		font-size: 1.2rem;
	}
	.practice {
		margin-top: 0.6rem;
	}
	.ok-text {
		color: var(--ok);
	}
	.strokes {
		display: block;
		width: 200px;
		height: 200px;
		background: #f4f2ee;
		border-radius: var(--radius-sm);
		margin-top: 0.5rem;
	}
	.used {
		font-size: 1.4rem;
	}
</style>
