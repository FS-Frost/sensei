<script lang="ts">
	import { goto } from '#lib/client/nav.ts';
	import { untrack } from 'svelte';
	import type { PageProps } from './$types';
	import { post, errMsg } from '#lib/client/api.ts';
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';
	import InstallCard from '#lib/components/InstallCard.svelte';
	import type { FuriganaMode } from '#lib/types.ts';

	let { data }: PageProps = $props();

	const PACES = [
		{ n: 5, label: 'Tranquilo', time: '10-15 min/día', desc: 'Ideal si estudias entre otras cosas. ~1800 kanji/año.' },
		{ n: 10, label: 'Constante', time: '20-30 min/día', desc: 'El equilibrio recomendado. ~3600/año: jōyō completo en menos de un año.' },
		{ n: 15, label: 'Intenso', time: '35-45 min/día', desc: 'Para cuando tienes tiempo diario fijo.' },
		{ n: 20, label: 'Muy intenso', time: '45-60+ min/día', desc: 'Exigente: los repasos crecen rápido.' }
	];

	let step = $state(0);
	let pace = $state(untrack(() => data.settings.newKanjiPerDay));
	let furigana: FuriganaMode = $state(untrack(() => data.settings.furigana));
	let saving = $state(false);
	let error = $state('');

	const STEPS = ['Bienvenida', 'El camino', 'El SRS', 'Tu ritmo', 'Leer sin muletas', 'El tutor', '¡A empezar!'];
	const last = STEPS.length - 1;

	async function finish(target: string) {
		saving = true;
		error = '';
		try {
			await post('/api/settings', {
				newKanjiPerDay: pace,
				newVocabPerDay: pace,
				newGrammarPerDay: pace >= 15 ? 3 : 2,
				furigana,
				onboardingDone: true
			});
			await goto(target, { refreshAll: true });
		} catch (e) {
			error = errMsg(e);
			saving = false;
		}
	}
</script>

<svelte:head><title>Bienvenida · Sensei</title></svelte:head>

<div class="wiz">
	<div class="dots" aria-label="Progreso">
		{#each STEPS as s, i (s)}
			<button class="dot" class:on={i === step} class:past={i < step} onclick={() => (step = i)} title={s} aria-label="Paso {i + 1}: {s}"></button>
		{/each}
	</div>

	<div class="card stack page">
		{#if step === 0}
			<h1><span class="jp accent">先生</span> Bienvenido a Sensei</h1>
			<p>
				Sensei es tu guía para un objetivo concreto: <strong>leer japonés</strong> —manga, novelas, videojuegos, carteles, webs— desde
				el español. No necesitas hablarlo.
			</p>
			<p>
				Nada aquí es al azar: el orden de lo que aprendes, cuándo repasas y qué lees está calculado para que cada minuto cuente. En los
				próximos pasos verás <strong>cómo funciona</strong> y elegirás tu ritmo. Son unos 3 minutos.
			</p>
			<p class="muted small">Puedes volver a esta guía cuando quieras desde la página <a href="/guia">Guía</a>.</p>
		{:else if step === 1}
			<h2>El camino: piezas → kanji → palabras → lectura</h2>
			<ol class="path">
				<li><strong class="c-comp">Componentes</strong> — las piezas visuales de los kanji (氵 «agua», 亻 «persona»). Pocas, reutilizadas en cientos de kanji.</li>
				<li><strong class="c-kanji">Kanji</strong> — cada uno con una mnemotecnia en español que combina sus componentes. Orden: <em>lo más frecuente primero</em>, siempre después de sus piezas.</li>
				<li><strong class="c-vocab">Vocabulario</strong> — se desbloquea cuando dominas sus kanji. Leer es reconocer palabras, no kanji sueltos.</li>
				<li><strong class="c-gram">Gramática</strong> — partículas y conjugaciones para reconocer, desbloqueadas según tus kanji.</li>
				<li>
					<strong>Lectura real</strong> — textos a tu nivel (casi todo conocido + un poco nuevo) y, sobre todo, <strong>lo que tú quieras
					leer</strong>: en la Biblioteca pegas un capítulo o un EPUB y Sensei te prepara para leerlo.
				</li>
			</ol>
			<p class="muted small">Ejemplo: 休 «descansar» = 亻 persona + 木 árbol → una persona apoyada en un árbol. Aprendes 亻 y 木 antes que 休.</p>
		{:else if step === 2}
			<h2>El SRS: repasar justo antes de olvidar</h2>
			<p>
				Cada cosa que aprendes se convierte en tarjetas (significado y lectura). Un algoritmo (FSRS) calcula cuándo vas a olvidarla y
				te la pregunta justo antes: al principio en minutos, luego días, luego meses.
			</p>
			<ul>
				<li><strong>Repasa cada día</strong>, aunque sean 5 minutos. Saltarse días acumula repasos.</li>
				<li><strong>Repasos antes que lecciones.</strong> Lo nuevo se apoya en lo viejo.</li>
				<li><strong>Sé honesto:</strong> si dudaste, marca «Difícil»; si fue una errata, «Contar como correcta».</li>
				<li>
					<strong>Freno automático:</strong> con 80+ repasos pendientes las lecciones se reducen a la mitad; con 150+ se pausan. Es para
					protegerte, no un castigo.
				</li>
			</ul>
		{:else if step === 3}
			<h2>Tu ritmo diario</h2>
			<p class="muted small">Kanji nuevos por día (y otras tantas palabras). El tiempo incluye los repasos cuando el ritmo se estabiliza.</p>
			<div class="paces">
				{#each PACES as p (p.n)}
					<button class="pace" class:sel={pace === p.n} onclick={() => (pace = p.n)}>
						<span class="big">{p.n}</span>
						<strong>{p.label}</strong>
						<span class="small">{p.time}</span>
						<span class="small muted">{p.desc}</span>
					</button>
				{/each}
			</div>
			<p class="small dim">Lo puedes cambiar cuando quieras en Ajustes. Mejor empezar bajo y subir que quemarse.</p>
		{:else if step === 4}
			<h2>Leer sin muletas</h2>
			<p>La <strong>furigana</strong> (lectura pequeña sobre el kanji) ayuda al principio, pero si siempre está, no aprendes a leer.</p>
			<div class="opts">
				<label class="check"><input type="radio" bind:group={furigana} value="adaptive" /> <span><strong>Adaptativa (recomendada)</strong> — se oculta en los kanji cuya lectura ya dominas; pasa el ratón para verla.</span></label>
				<label class="check"><input type="radio" bind:group={furigana} value="always" /> <span>Siempre visible</span></label>
				<label class="check"><input type="radio" bind:group={furigana} value="never" /> <span>Oculta</span></label>
			</div>
			<ul class="small">
				<li><strong>Toca o pasa el ratón</strong> sobre cualquier palabra japonesa para ver el diccionario y añadirla al SRS.</li>
				<li>Las lecturas se escriben en <strong>romaji y se convierten solas a kana</strong> (escribe «yama» → やま).</li>
				<li>El botón 🔊 lee en voz alta (si tu sistema tiene voz japonesa).</li>
			</ul>
			<div class="row small">Tema: <ThemeToggle /></div>
		{:else if step === 5}
			<h2>El tutor</h2>
			{#if data.gemini}
				<p>Un tutor con IA (Gemini) que conoce tu progreso, tus fallos y tus confusiones, y recuerda las sesiones anteriores.</p>
				<ul>
					<li><strong>Conversación-quiz</strong>: te pregunta por turnos y se adapta.</li>
					<li><strong>Quiz a medida</strong>: pide «10 preguntas con 氵» o «vocabulario de comida».</li>
					<li><strong>Explicador</strong>: pega una frase o una foto de manga y la desglosa.</li>
					<li><strong>Detective de confusiones</strong>: ejercicios para separar 未/末, 土/士…</li>
				</ul>
				<p class="small muted">Sus lecturas se comprueban contra el diccionario; si algo no cuadra, se marca con subrayado punteado.</p>
			{:else}
				<div class="warning small">
					Sin API key de Gemini el tutor, las lecturas graduadas, el explicador y las mnemotecnias no están disponibles. El SRS, las
					lecciones y el diccionario funcionan igual. Puedes añadirla luego en <a href="/ajustes#gemini">Ajustes</a> (es gratis crearla
					en Google AI Studio).
				</div>
			{/if}
		{:else}
			<h2>¡A empezar!</h2>
			{#if !data.diagDone}
				<p>
					Primer paso recomendado: el <strong>diagnóstico de kana</strong> (~5 min). Detecta los hiragana/katakana en los que dudas y
					solo esos entran a tu SRS. Si los kana fallan, todo lo demás cuesta el doble.
				</p>
			{:else}
				<p>Ya hiciste el diagnóstico de kana. Siguiente paso: tu <strong>primera lección</strong> de kanji.</p>
			{/if}
			<p class="small muted">
				Cada día, la página de Inicio te dirá <strong>qué hacer ahora y por qué</strong>, y en qué punto del viaje estás. ¿Ya sabes
				algunos kanji? Haz después el <a href="/nivel">test de nivel</a> para no repetir lo que dominas.
			</p>
			<InstallCard dismissible={false} />
			{#if error}<div class="error small">{error}</div>{/if}
			<div class="row">
				{#if !data.diagDone}
					<button class="primary" onclick={() => finish('/kana')} disabled={saving}>Ir al diagnóstico de kana</button>
				{:else}
					<button class="primary" onclick={() => finish('/leccion')} disabled={saving}>Primera lección</button>
				{/if}
				<button onclick={() => finish('/')} disabled={saving}>Ir al inicio</button>
			</div>
		{/if}
	</div>

	<div class="spread">
		<button onclick={() => (step = Math.max(0, step - 1))} disabled={step === 0}>← Atrás</button>
		<button class="ghost small" onclick={() => finish('/')} disabled={saving} title="Guarda tu ritmo y furigana actuales">Saltar guía</button>
		{#if step < last}
			<button class="primary" onclick={() => step++}>Siguiente →</button>
		{:else}
			<span></span>
		{/if}
	</div>
</div>

<style>
	.wiz {
		max-width: 680px;
		margin: 0 auto;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.dots {
		display: flex;
		gap: 0.4rem;
		justify-content: center;
	}
	.dot {
		width: 0.7rem;
		height: 0.7rem;
		padding: 0;
		border-radius: 50%;
		background: var(--bg-3);
	}
	.dot.past {
		background: var(--text-3);
	}
	.dot.on {
		background: var(--accent);
		border-color: var(--accent);
	}
	.page {
		min-height: 340px;
	}
	.accent {
		color: var(--accent);
	}
	.path {
		display: grid;
		gap: 0.6rem;
		padding-left: 1.2rem;
	}
	.c-comp {
		color: var(--component);
	}
	.c-kanji {
		color: var(--kanji);
	}
	.c-vocab {
		color: var(--vocab);
	}
	.c-gram {
		color: var(--accent-2);
	}
	.paces {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 0.6rem;
	}
	.pace {
		flex-direction: column;
		align-items: flex-start;
		text-align: left;
		gap: 0.15rem;
		padding: 0.8rem;
	}
	.pace.sel {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, var(--bg-3));
	}
	.big {
		font-size: 1.8rem;
		font-weight: 600;
		line-height: 1;
	}
	.opts {
		display: grid;
		gap: 0.5rem;
	}
	.check {
		display: flex;
		gap: 0.55rem;
		align-items: flex-start;
		color: var(--text);
		margin: 0;
	}
	.check input {
		width: auto;
		margin-top: 0.3rem;
	}
</style>
