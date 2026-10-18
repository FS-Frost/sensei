<script lang="ts">
	// Lección de un kana: grande, con su sonido, cómo se forma (derivados), una imagen para recordarlo, una palabra
	// real, los parecidos y, si se puede, practicar el trazo (KanjiVG). Contenido fijo (kanaCourse.ts): sin IA.
	import type { KanaInfo } from '../types.ts';
	import SpeakButton from './SpeakButton.svelte';
	import KanjiTrace from './KanjiTrace.svelte';
	import { wordRomaji } from '../kana.ts';

	let { k }: { k: KanaInfo } = $props();
	let tracing = $state(false);
	$effect(() => {
		void k.char;
		tracing = false;
	});
</script>

<div class="kc stack">
	{#if k.rule}<div class="rule small"><strong>{k.row}.</strong> {k.rule}</div>{/if}
	<div class="head">
		<div class="char jp">{k.char}</div>
		<div class="stack tight">
			<div class="romaji">{k.romaji === '-' ? 'alarga la vocal' : k.romaji}</div>
			<div class="row small dim">
				<span>{k.script === 'hiragana' ? 'Hiragana' : 'Katakana'} · {k.row}</span>
				<SpeakButton text={k.example && k.group === 'special' ? k.example.word : k.char} />
			</div>
			{#if k.formation}<div class="small">Se forma: <span class="jp">{k.formation}</span></div>{/if}
		</div>
	</div>

	{#if k.mnemonic}<p class="mnemonic">{k.mnemonic}</p>{/if}

	{#if k.example}
		<div class="example">
			<span class="jp word">{k.example.word}</span>
			<span class="dim">{wordRomaji(k.example.word)[0]}</span>
			<span>— {k.example.es}</span>
			<SpeakButton text={k.example.word} />
		</div>
	{/if}

	{#if k.similar.length}
		<div class="warning similar small">
			<strong>¡Ojo con los parecidos!</strong>
			{#each k.similar as x (x.char)}
				<div><span class="jp sim">{x.char}</span> {x.tip}</div>
			{/each}
		</div>
	{/if}

	{#if k.traceable}
		<div>
			<button class="small" onclick={() => (tracing = !tracing)}>{tracing ? 'Ocultar' : '✍ Practicar el trazo'}</button>
		</div>
		{#if tracing}
			{#key k.char}<KanjiTrace char={k.char} guided size={220} />{/key}
			<p class="dim small">Trazos: KanjiVG (CC-BY-SA). Sigue el orden: cada trazo correcto queda limpio.</p>
		{/if}
	{/if}
</div>

<style>
	.head {
		display: flex;
		gap: 1.2rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.char {
		font-size: 6rem;
		line-height: 1;
		background: var(--kana);
		color: #fff;
		border-radius: var(--radius);
		padding: 0.6rem 0.9rem;
		min-width: 1.4em;
		text-align: center;
	}
	.romaji {
		font-size: 2rem;
		font-weight: 600;
		letter-spacing: 0.03em;
	}
	.tight {
		gap: 0.25rem;
	}
	.mnemonic {
		margin: 0;
		font-size: 1.1rem;
		border-left: 3px solid var(--kana);
		padding-left: 0.7rem;
	}
	.example {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.word {
		font-size: 1.6rem;
	}
	.rule {
		background: var(--bg-3);
		border-radius: var(--radius-sm);
		padding: 0.6rem 0.8rem;
	}
	.similar {
		display: grid;
		gap: 0.3rem;
	}
	.sim {
		font-size: 1.4rem;
		margin-right: 0.3rem;
	}
</style>
