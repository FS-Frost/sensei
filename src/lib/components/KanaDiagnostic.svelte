<script lang="ts" module>
	export type Outcome = { weak: { kana: string; reason: 'wrong' | 'slow'; answer: string }[]; known: number; skipped: ('hiragana' | 'katakana')[] };
</script>

<script lang="ts">
	// Diagnóstico adaptativo de kana, por escritura: primero una muestra de ~15 (básicos, algún dakuten y combinado).
	// Con 6 fallos en la muestra se corta: esa escritura se aprende desde cero en las lecciones (no se crea nada).
	// Si la muestra va bien, se sigue con el resto. Lo correcto y rápido queda «ya sabido»; lo demás, a aprender.
	import { refreshAll } from '$app/navigation';
	import { post, errMsg } from '../client/api.ts';
	import { toast } from '../client/toast.svelte.ts';
	import { acceptedRomaji, kanaScript } from '../kana.ts';
	import { KANA_ROWS, SPECIAL_WORDS, isSpecialKana, type KanaScript } from '../kanaCourse.ts';
	import AnswerInput from './AnswerInput.svelte';
	import { KANA_SAMPLE_FAILS } from '../algoConstants.ts';

	let { scripts = ['hiragana', 'katakana'], ondone }: { scripts?: KanaScript[]; ondone?: (r: Outcome) => void } = $props();

	type Result = { kana: string; answer: string; ms: number };
	type Q = { kana: string; prompt: string };

	const SAMPLE_FAILS = KANA_SAMPLE_FAILS;
	const shuffle = <T,>(a: T[]) => [...a].sort(() => Math.random() - 0.5);
	const promptOf = (k: string) => (isSpecialKana(k) ? shuffle(SPECIAL_WORDS[k])[0].word : k);

	function sampleFor(script: KanaScript): string[] {
		const rows = KANA_ROWS.filter((r) => r.script === script);
		// 1-2 por fila básica, 3 con dakuten y 2 combinados: cubre todo sin ser largo.
		const basic = rows.filter((r) => r.group === 'basic').flatMap((r) => shuffle(r.chars).slice(0, r.chars.length > 3 ? 2 : 1));
		const dak = shuffle(rows.filter((r) => r.group === 'dakuten').flatMap((r) => r.chars)).slice(0, 3);
		const yoon = shuffle(rows.filter((r) => r.group === 'yoon').flatMap((r) => r.chars)).slice(0, 2);
		return shuffle([...shuffle(basic).slice(0, 10), ...dak, ...yoon]);
	}

	let queue: Q[] = $state([]);
	let i = $state(0);
	let phase: 'sample' | 'rest' = $state('sample');
	let scriptIdx = $state(0);
	let fails = $state(0);
	let answer = $state('');
	let flash: { ok: boolean; right: string } | null = $state(null);
	let t0 = 0;
	const results: Result[] = [];
	const skipped: KanaScript[] = [];
	let sending = $state(false);
	let note = $state('');

	const script = $derived(scripts[scriptIdx]);

	function startScript(idx: number) {
		scriptIdx = idx;
		phase = 'sample';
		fails = 0;
		queue = sampleFor(scripts[idx]).map((k) => ({ kana: k, prompt: promptOf(k) }));
		i = 0;
		t0 = performance.now();
	}
	$effect.pre(() => {
		if (!queue.length && scripts.length) startScript(0);
	});

	function advance() {
		if (++i < queue.length) {
			t0 = performance.now();
			return;
		}
		if (phase === 'sample') {
			// La muestra fue bien: el resto de esa escritura.
			const asked = new Set(queue.map((q) => q.kana));
			const rest = KANA_ROWS.filter((r) => r.script === script).flatMap((r) => r.chars).filter((k) => !asked.has(k));
			phase = 'rest';
			queue = shuffle(rest).map((k) => ({ kana: k, prompt: promptOf(k) }));
			i = 0;
			note = `Bien: sigue con el resto del ${script}.`;
			t0 = performance.now();
			return;
		}
		nextScriptOrFinish();
	}

	function nextScriptOrFinish() {
		if (scriptIdx + 1 < scripts.length) {
			startScript(scriptIdx + 1);
			note = `Ahora, ${scripts[scriptIdx]}.`;
		} else void finish();
	}

	function submit() {
		if (flash || !queue[i]) return;
		const q = queue[i];
		const a = answer.trim().toLowerCase().replace(/[\s'-]/g, '');
		results.push({ kana: q.kana, answer: a, ms: Math.round(performance.now() - t0) });
		const ok = acceptedRomaji(q.kana).includes(a);
		if (!ok && phase === 'sample') fails++;
		flash = { ok, right: acceptedRomaji(q.kana)[0] };
		setTimeout(
			() => {
				flash = null;
				answer = '';
				if (phase === 'sample' && fails >= SAMPLE_FAILS) {
					// Muchos fallos: esta escritura se aprende desde cero (no se guarda nada de ella).
					skipped.push(script);
					note = `El ${script} lo aprenderás desde cero en las lecciones.`;
					nextScriptOrFinish();
				} else advance();
			},
			ok ? 150 : 900
		);
	}

	async function finish() {
		sending = true;
		try {
			const keep = results.filter((r) => !skipped.includes(kanaScript(r.kana)));
			const r = await post<Outcome>('/api/kana/diagnostic', { results: keep, skipped });
			await refreshAll();
			ondone?.({ ...r, skipped });
		} catch (e) {
			toast.error('No se pudo guardar el diagnóstico', { detail: errMsg(e) });
		} finally {
			sending = false;
		}
	}
</script>

<div class="run">
	{#if sending}
		<span class="spinner"></span>
	{:else if queue[i]}
		<div class="small muted">
			{script === 'hiragana' ? 'Hiragana' : 'Katakana'} · {phase === 'sample' ? 'muestra' : 'resto'} · {i + 1} / {queue.length}
		</div>
		{#if note}<div class="small">{note}</div>{/if}
		<div class="kana jp" class:word={[...queue[i].prompt].length > 2} class:ok={flash?.ok} class:bad={flash && !flash.ok}>
			{queue[i].prompt}
		</div>
		<div class="hint">{#if flash && !flash.ok}{flash.right}{/if}</div>
		<AnswerInput bind:value={answer} mode="romaji" disabled={!!flash} onsubmit={submit} />
		<div class="row">
			<button class="ghost small" onclick={() => void finish()}>Terminar ahora</button>
			{#if phase === 'sample'}
				<button class="ghost small" onclick={() => { skipped.push(script); nextScriptOrFinish(); }}>No sé {script === 'hiragana' ? 'hiragana' : 'katakana'}</button>
			{/if}
		</div>
		<p class="dim small">Escribe el romaji (ka, shi, kya…). Si no lo sabes, deja vacío y pulsa Enter.</p>
	{/if}
</div>

<style>
	.run {
		max-width: 420px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.7rem;
		width: 100%;
	}
	.kana {
		font-size: 7rem;
		line-height: 1.1;
		background: var(--kana);
		color: #fff;
		width: 100%;
		text-align: center;
		border-radius: var(--radius);
		padding: 0.5rem;
		transition: background 0.1s;
	}
	.kana.word {
		font-size: 3.6rem;
		padding: 1.4rem 0.5rem;
	}
	.kana.ok {
		background: var(--ok);
	}
	.kana.bad {
		background: var(--bad);
	}
	.hint {
		min-height: 1.6rem;
		font-size: 1.3rem;
		color: var(--bad);
	}
</style>
