<script lang="ts">
	import HelpLink from '#lib/components/HelpLink.svelte';
	import { onMount } from 'svelte';
	import { refreshAll } from '$app/navigation';
	import { get, errMsg } from '#lib/client/api.ts';
	import type { LessonItem, ReviewItem } from '#lib/types.ts';
	import KanjiDetail from '#lib/components/KanjiDetail.svelte';
	import ReviewSession from '#lib/components/ReviewSession.svelte';
	import SpeakButton from '#lib/components/SpeakButton.svelte';
	import PromptText from '#lib/components/PromptText.svelte';
	import { setScreenContext } from '#lib/client/tutorContext.svelte.ts';
	import { completeDaily } from '#lib/client/daily.svelte.ts';

	type Quota = { kanjiLeft: number; vocabLeft: number; grammarLeft: number; brake: string; due: number; queued: number };
	type Lesson = { items: LessonItem[]; quiz: ReviewItem[]; quota: Quota; warning: string | null };

	let lesson = $state<Lesson | null>(null);
	let loading = $state(false);
	let error = $state('');
	let idx = $state(0);
	let stage: 'learn' | 'quiz' | 'done' = $state('learn');
	let kind: 'auto' | 'kanji' | 'vocab' = $state('auto');

	async function load() {
		loading = true;
		error = '';
		stage = 'learn';
		idx = 0;
		try {
			lesson = await get<Lesson>(`/api/lesson?kind=${kind}`);
			if (!lesson.items.length) completeDaily('lesson'); // nada que aprender hoy: el bloque de la sesión diaria cuenta
		} catch (e) {
			error = errMsg(e);
		} finally {
			loading = false;
		}
	}

	onMount(load);

	const item = $derived(lesson?.items[idx]);

	// Contexto para el tutor mientras estudias un ítem (en el quiz lo publica ReviewSession).
	$effect(() => {
		if (stage !== 'learn' || !item) return;
		const desc =
			item.type === 'kanji'
				? { kanji: item.key, meanings: item.kanji.meaningsEs, on: item.kanji.onReadings, kun: item.kanji.kunReadings, components: item.kanji.components.map((c) => `${c.symbol}(${c.nameEs ?? '?'})`), mnemonic: item.kanji.mnemonicMeaning }
				: item.type === 'component'
					? { component: item.key, name: item.component.nameEs }
					: item.type === 'vocab'
						? { word: item.vocab.mainForm, readings: item.vocab.kanaForms, meanings: item.vocab.glossesEs ?? item.vocab.glossesEn }
						: { grammar: item.grammar.pattern, meaning: item.grammar.meaning, explanation: item.grammar.explanation };
		const shown = item.type === 'vocab' ? item.vocab.mainForm : item.type === 'grammar' ? item.grammar.pattern : item.key;
		setScreenContext({ kind: 'lesson', label: `lección · ${shown}`, data: desc });
	});
	const TYPE_LABEL = { component: 'Componente', kanji: 'Kanji', vocab: 'Vocabulario', grammar: 'Gramática' } as const;

	function onkeydown(e: KeyboardEvent) {
		if (stage !== 'learn' || !lesson || e.target instanceof HTMLInputElement) return;
		if (e.key === 'ArrowRight') idx = Math.min(lesson.items.length - 1, idx + 1);
		if (e.key === 'ArrowLeft') idx = Math.max(0, idx - 1);
	}
</script>

<svelte:window {onkeydown} />
<svelte:head><title>Lección · Sensei</title></svelte:head>

<div class="spread">
	<h1>Lección <HelpLink section="leccion" /></h1>
	<div class="row">
		<select bind:value={kind} onchange={load} aria-label="Tipo de lección" style="width:auto">
			<option value="auto">Automática</option>
			<option value="kanji">Kanji</option>
			<option value="vocab">Vocabulario</option>
			<option value="grammar">Gramática</option>
		</select>
	</div>
</div>

{#if loading}
	<div class="card row"><span class="spinner"></span> Preparando la lección (el tutor genera mnemotecnias la primera vez)…</div>
{:else if error}
	<div class="error">{error}</div>
{:else if lesson}
	{#if lesson.warning}<div class="warning small">{lesson.warning}</div>{/if}

	{#if !lesson.items.length}
		<div class="card stack">
			{#if lesson.quota.brake === 'stop'}
				<p>Lecciones en pausa: tienes {lesson.quota.due} repasos pendientes. Repasa primero para no saturarte.</p>
				<a class="btn primary" href="/repaso">Ir a repaso</a>
			{:else if lesson.quota.kanjiLeft === 0 && lesson.quota.vocabLeft === 0 && lesson.quota.grammarLeft === 0}
				<p>Ya completaste el cupo de hoy. Puedes subirlo en <a href="/ajustes">Ajustes</a>.</p>
			{:else}
				<p>No hay ítems disponibles ahora. El vocabulario se desbloquea cuando sus kanji pasan a repaso.</p>
			{/if}
		</div>
	{:else if stage === 'learn' && item}
		<div class="row dots">
			{#each lesson.items as it, i (it.type + it.key)}
				<button class="dot t-{it.type}" class:on={i === idx} onclick={() => (idx = i)} aria-label="Ítem {i + 1}">
					<span class="jp">{it.type === 'vocab' ? it.vocab.mainForm : it.type === 'grammar' ? it.grammar.pattern : it.key}</span>
				</button>
			{/each}
		</div>

		<div class="card">
			<span class="badge {item.type}">{TYPE_LABEL[item.type]}</span>
			<div class="body">
				{#if item.type === 'kanji'}
					<KanjiDetail k={item.kanji} compact />
					{#if item.similar.length}
						<div class="warning similar">
							<strong>¡Ojo! Se parece a lo que ya sabes:</strong>
							{#each item.similar as x (x.char)}
								<div class="row">
									<a class="jp sim" href="/kanji/{x.char}">{x.char}</a>
									<span>«{x.meaning}»{x.tip ? ` — ${x.tip}` : ''}</span>
								</div>
							{/each}
						</div>
					{/if}
				{:else if item.type === 'grammar'}
					{@const g = item.grammar}
					<div class="stack">
						<div class="jp gpattern">{g.pattern}</div>
						<div class="meaning">{g.meaning}</div>
						<p>{g.explanation}</p>
						<div>
							<h3>Ejemplos</h3>
							{#each g.examples as ex, i (i)}
								<div class="ex">
									<div class="jp ex-jp"><PromptText text={ex.jp} highlight={g.pattern} /> <SpeakButton text={ex.jp} /></div>
									<div class="small muted">{ex.es}</div>
								</div>
							{/each}
						</div>
						<p class="small dim">
							Objetivo: <strong>reconocerlo al leer</strong>, no producirlo. En el quiz eliges qué expresa en una frase de ejemplo.
						</p>
					</div>
				{:else if item.type === 'component'}
					<div class="comp">
						<div class="sym jp">{item.component.symbol}</div>
						<div class="stack">
							<div class="name">{item.component.nameEs ?? '—'}</div>
							<p class="muted small">
								Los componentes no son palabras: son piezas visuales con un nombre para construir mnemotecnias.
							</p>
							{#if item.component.usedIn.length}
								<div class="small">Aparece en: <span class="jp used">{item.component.usedIn.slice(0, 12).join(' ')}</span></div>
							{/if}
						</div>
					</div>
				{:else}
					{@const v = item.vocab}
					<div class="stack">
						<div class="row">
							<span class="jp vocab">{v.mainForm}</span>
							<SpeakButton text={v.mainReading} />
						</div>
						<div class="jp reading">{v.kanaForms.slice(0, 3).join('・')}</div>
						<div class="meaning">{(v.glossesEs ?? v.glossesEn).slice(0, 4).join('; ')}</div>
						{#if v.sentences?.length}
							<div>
								<h3>Ejemplos</h3>
								{#each v.sentences as s, i (i)}
									<div class="ex">
										<div class="jp">{s.jp} <SpeakButton text={s.jp} /></div>
										<div class="small muted">{s.es ?? s.en}</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		<div class="spread">
			<button onclick={() => (idx = Math.max(0, idx - 1))} disabled={idx === 0}>← Anterior</button>
			{#if idx < lesson.items.length - 1}
				<button class="primary" onclick={() => idx++}>Siguiente →</button>
			{:else}
				<button class="primary" onclick={() => (stage = 'quiz')}>Empezar quiz ({lesson.quiz.length})</button>
			{/if}
		</div>
	{:else if stage === 'quiz'}
		<p class="muted small">Responde cada pregunta. Los fallos vuelven al final hasta acertarlos.</p>
		<ReviewSession
			items={lesson.quiz}
			source="lesson"
			requeueWrong
			onfinish={() => {
				stage = 'done';
				completeDaily('lesson');
				refreshAll();
			}}
		/>
	{:else if stage === 'done'}
		<div class="card stack">
			<h2>Lección completada ✓</h2>
			<p class="muted">Estos ítems ya están en tu SRS y aparecerán en los repasos.</p>
			<div class="row">
				<button class="primary" onclick={load}>Otra lección</button>
				<a class="btn" href="/repaso">Repaso</a>
				<a class="btn" href="/tutor?nuevo=conversacion">Practicar con el tutor</a>
			</div>
		</div>
	{/if}
{/if}

<style>
	.dots {
		gap: 0.35rem;
	}
	.dot {
		padding: 0.25rem 0.55rem;
		font-size: 1rem;
		opacity: 0.55;
	}
	.dot.on {
		opacity: 1;
		border-color: var(--text-2);
	}
	.t-kanji {
		color: var(--kanji);
	}
	.t-component {
		color: var(--component);
	}
	.t-vocab {
		color: var(--vocab);
	}
	.body {
		margin-top: 0.8rem;
	}
	.comp {
		display: flex;
		gap: 1.2rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.comp .sym {
		font-size: 6rem;
		line-height: 1;
		background: var(--component);
		color: #fff;
		border-radius: var(--radius);
		padding: 0.6rem 0.9rem;
	}
	.name {
		font-size: 1.5rem;
		font-weight: 600;
	}
	.used {
		font-size: 1.2rem;
	}
	.vocab {
		font-size: 3.5rem;
		line-height: 1.1;
		color: var(--vocab);
	}
	.reading {
		font-size: 1.4rem;
	}
	.meaning {
		font-size: 1.2rem;
	}
	.ex {
		margin-top: 0.5rem;
	}
	.ex-jp {
		font-size: 1.25rem;
		line-height: 2;
	}
	.gpattern {
		font-size: 2.4rem;
		color: var(--accent-2);
	}
	.similar {
		margin-top: 1rem;
		display: grid;
		gap: 0.3rem;
	}
	.sim {
		font-size: 1.8rem;
		color: var(--kanji);
	}
	.t-grammar {
		color: var(--accent-2);
	}
</style>
