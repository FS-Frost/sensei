<script lang="ts">
	import HelpLink from '#lib/components/HelpLink.svelte';
	import { refreshAll } from '$app/navigation';
	import { post, errMsg } from '#lib/client/api.ts';
	import { HIRAGANA_BASIC, HIRAGANA_DAKUTEN, KATAKANA_BASIC, KATAKANA_DAKUTEN, acceptedRomaji } from '#lib/kana.ts';
	import AnswerInput from '#lib/components/AnswerInput.svelte';

	type Result = { kana: string; answer: string; ms: number };

	let stage: 'start' | 'run' | 'done' = $state('start');
	let queue: string[] = $state([]);
	let i = $state(0);
	let answer = $state('');
	let results: Result[] = $state([]);
	let flash: { ok: boolean; right: string } | null = $state(null);
	let t0 = 0;
	let weak: { kana: string; reason: 'wrong' | 'slow'; answer: string }[] = $state([]);
	let error = $state('');
	let sending = $state(false);

	function shuffle<T>(a: T[]) {
		const arr = [...a];
		for (let j = arr.length - 1; j > 0; j--) {
			const k = Math.floor(Math.random() * (j + 1));
			[arr[j], arr[k]] = [arr[k], arr[j]];
		}
		return arr;
	}

	function start(full: boolean) {
		const set = full
			? [...HIRAGANA_BASIC, ...HIRAGANA_DAKUTEN, ...KATAKANA_BASIC, ...KATAKANA_DAKUTEN]
			: [...HIRAGANA_BASIC, ...KATAKANA_BASIC];
		queue = shuffle(set);
		i = 0;
		results = [];
		answer = '';
		stage = 'run';
		t0 = performance.now();
	}

	function submit() {
		if (flash) return;
		const kana = queue[i];
		const a = answer.trim().toLowerCase();
		results.push({ kana, answer: a, ms: Math.round(performance.now() - t0) });
		const ok = acceptedRomaji(kana).includes(a);
		flash = { ok, right: acceptedRomaji(kana)[0] };
		setTimeout(
			() => {
				flash = null;
				answer = '';
				if (++i >= queue.length) finish();
				else t0 = performance.now();
			},
			ok ? 150 : 900
		);
	}

	async function finish() {
		stage = 'done';
		sending = true;
		try {
			const r = await post<{ weak: typeof weak }>('/api/kana/diagnostic', { results });
			weak = r.weak;
			await refreshAll();
		} catch (e) {
			error = errMsg(e);
		} finally {
			sending = false;
		}
	}

	const correct = $derived(results.filter((r) => acceptedRomaji(r.kana).includes(r.answer)).length);
</script>

<svelte:head><title>Kana · Sensei</title></svelte:head>

<h1>Diagnóstico de kana <HelpLink section="kana" /></h1>

{#if stage === 'start'}
	<div class="card stack">
		<p>
			Escribe el romaji de cada kana lo más rápido que puedas. Los que falles o tardes más de 4 s en responder entran a tu
			SRS; el resto se considera dominado.
		</p>
		<div class="row">
			<button class="primary" onclick={() => start(false)}>Básicos (92)</button>
			<button onclick={() => start(true)}>Completo con dakuten (142)</button>
		</div>
		<p class="dim small">Puedes repetirlo cuando quieras.</p>
	</div>
{:else if stage === 'run'}
	<div class="run">
		<div class="small muted">{i + 1} / {queue.length}</div>
		<div class="kana jp" class:ok={flash?.ok} class:bad={flash && !flash.ok}>{queue[i]}</div>
		<div class="hint">{#if flash && !flash.ok}{flash.right}{/if}</div>
		<AnswerInput bind:value={answer} mode="romaji" disabled={!!flash} onsubmit={submit} />
		<button class="ghost small" onclick={finish}>Terminar ahora</button>
	</div>
{:else}
	<div class="card stack">
		<h2>Resultado: {correct} / {results.length}</h2>
		{#if sending}
			<span class="spinner"></span>
		{:else if error}
			<div class="error">{error}</div>
		{:else if weak.length}
			<p>Estos kana entraron a tu SRS:</p>
			<div class="row jp weak">
				{#each weak as w (w.kana)}
					<span class="badge" title={w.reason === 'slow' ? 'lento' : `respondiste «${w.answer}»`}>
						{w.kana} <span class="dim">{w.reason === 'slow' ? '⏱' : '✗'}</span>
					</span>
				{/each}
			</div>
			<a class="btn primary" href="/repaso">Repasarlos ahora</a>
		{:else}
			<p>¡Perfecto! Dominas los kana. Ve directo a los kanji.</p>
			<a class="btn primary" href="/leccion">Primera lección</a>
		{/if}
	</div>
{/if}

<style>
	.run {
		max-width: 420px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.8rem;
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
	.weak {
		font-size: 1.4rem;
	}
</style>
