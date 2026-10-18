<script lang="ts">
	import { toast } from '#lib/client/toast.svelte.ts';
	import { goto } from '#lib/client/nav.ts';
	import { untrack } from 'svelte';
	import type { PageProps } from './$types';
	import { post, errMsg } from '#lib/client/api.ts';
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';
	import InstallCard from '#lib/components/InstallCard.svelte';
	import AiChoice from '#lib/components/AiChoice.svelte';
	import { aiKey, aiMode, aiUi } from '#lib/client/ai.svelte.ts';
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

	const STEPS = ['Bienvenida', 'El camino', 'Tu punto de partida', 'El SRS', 'Tu ritmo', 'Leer sin muletas', 'La IA', '¡A empezar!'];
	const last = STEPS.length - 1;

	// ---------- Punto de partida ----------
	type KanaSelf = 'none' | 'some' | 'slow' | 'fluent';
	const KANA_SELF: { v: KanaSelf; label: string }[] = [
		{ v: 'none', label: 'No lo sé' },
		{ v: 'some', label: 'Algunos' },
		{ v: 'slow', label: 'Lo leo, lento' },
		{ v: 'fluent', label: 'Con fluidez' }
	];
	const KANJI_SELF = [
		{ v: 'none', label: 'Ninguno' },
		{ v: 'some', label: 'Algunos (<100)' },
		{ v: 'basic', label: 'Básicos (~300)' },
		{ v: 'many', label: 'Bastantes (600+)' }
	] as const;
	let level = $state(
		untrack(() => data.settings.startLevel ?? { hiragana: 'none' as KanaSelf, katakana: 'none' as KanaSelf, kanji: 'none' as 'none' | 'some' | 'basic' | 'many' })
	);
	/** Escrituras a diagnosticar (las que dices saber algo); las demás, al curso desde cero. */
	const diagScripts = $derived((['hiragana', 'katakana'] as const).filter((s) => level[s] !== 'none'));
	const planText = $derived(
		(level.hiragana === 'none'
			? 'Empezarás aprendiendo el hiragana fila a fila (unos días, 10 kana al día), con una imagen para cada uno. '
			: `Una prueba corta de ${diagScripts.join(' y ')} detectará lo que dominas y lo que no. `) +
			(level.katakana === 'none' && level.hiragana !== 'none' ? 'El katakana lo aprenderás en las lecciones, junto a los primeros kanji. ' : '') +
			(level.kanji !== 'none' ? 'Después, el test de nivel de kanji para no repetir lo que ya sabes.' : 'Los kanji empiezan cuando termines el hiragana básico.')
	);
	/** Adónde lleva «empezar»: el diagnóstico de lo que dices saber, o la primera lección de kana. */
	const startTarget = $derived(diagScripts.length ? `/kana?diag=${diagScripts.join(',')}` : '/leccion');

	async function finish(target: string) {
		saving = true;
		try {
			await post('/api/settings', {
				newKanjiPerDay: pace,
				newVocabPerDay: pace,
				newGrammarPerDay: pace >= 15 ? 3 : 2,
				furigana,
				startLevel: level,
				onboardingDone: true
			});
			await goto(target, { refreshAll: true });
		} catch (e) {
			toast.error('No se pudo guardar tu ritmo', { detail: errMsg(e) });
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
				<li><strong class="c-kana">Kana</strong> — los dos silabarios (hiragana y katakana), un sonido por letra. Si no los sabes, empiezas por aquí: unos días.</li>
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
			<h2>Tu punto de partida</h2>
			<p class="muted small">Así Sensei empieza donde estás: desde cero, con una prueba corta o saltando lo que ya dominas.</p>
			{#each [['hiragana', 'Hiragana (あいう…)', 'Las letras redondeadas: con ellas se escribe la gramática y cualquier palabra.'], ['katakana', 'Katakana (アイウ…)', 'Las angulosas: palabras extranjeras, nombres y onomatopeyas.']] as const as [key, label, desc] (key)}
				<fieldset class="q">
					<legend><strong>{label}</strong> <span class="small muted">— {desc}</span></legend>
					<div class="opts-row">
						{#each KANA_SELF as o (o.v)}
							<label class="pill" class:sel={level[key] === o.v}><input type="radio" bind:group={level[key]} value={o.v} /> {o.label}</label>
						{/each}
					</div>
				</fieldset>
			{/each}
			<fieldset class="q">
				<legend><strong>Kanji</strong></legend>
				<div class="opts-row">
					{#each KANJI_SELF as o (o.v)}
						<label class="pill" class:sel={level.kanji === o.v}><input type="radio" bind:group={level.kanji} value={o.v} /> {o.label}</label>
					{/each}
				</div>
			</fieldset>
			<p class="small">{planText}</p>
		{:else if step === 3}
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
		{:else if step === 4}
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
		{:else if step === 5}
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
		{:else if step === 6}
			<h2>La IA: un tutor, si lo quieres</h2>
			<p>Con IA (Gemini) tienes un tutor que conoce tu progreso, tus fallos y tus confusiones, y recuerda las sesiones anteriores.</p>
			<ul>
				<li><strong>Conversación-quiz</strong>: te pregunta por turnos y se adapta.</li>
				<li><strong>Quiz a medida</strong>: pide «10 preguntas con 氵» o «vocabulario de comida».</li>
				<li><strong>Explicador</strong>: pega una frase o una foto de manga y la desglosa.</li>
				<li><strong>Lecturas graduadas</strong> a tu nivel y <strong>«¿Por qué?»</strong> al fallar un repaso.</li>
			</ul>
			{#if aiMode() === 'ask' && !aiKey()}
				<!-- Con `ondone` no navega: el asistente sigue en este paso y muestra lo elegido. -->
				<AiChoice compact ondone={() => {}} />
			{:else if aiUi()}
				<p class="small">
					✓ IA activada{aiKey() ? '' : ': pega tu API key en Ajustes cuando termines (es gratis crearla en Google AI Studio)'}. Si
					prefieres no usarla, cámbialo en <a href="/ajustes#ia">Ajustes</a>.
				</p>
			{:else}
				<p class="small">
					✓ <strong>Modo sin IA</strong>: el SRS, las lecciones, el diccionario y la biblioteca
					funcionan igual, con mnemotecnias ya preparadas para los primeros 500 kanji. Puedes activarla cuando quieras en Ajustes.
				</p>
			{/if}
		{:else}
			<h2>¡A empezar!</h2>
			{#if data.diagDone}
				<p>Ya hiciste el diagnóstico de kana. Siguiente paso: tu <strong>primera lección</strong>.</p>
			{:else if diagScripts.length}
				<p>
					Primer paso: una <strong>prueba corta de {diagScripts.join(' y ')}</strong> (~3-5 min). Empieza con una muestra: si fallas
					mucho, esa escritura se aprende desde cero; si no, detecta lo que dudas y solo eso entra a tu SRS.
				</p>
			{:else}
				<p>
					Primer paso: tu <strong>primera lección de hiragana</strong>, las vocales あいうえお. Cada kana trae su sonido, una imagen
					para recordarlo, una palabra real y su trazo. Con 10 al día, en unos 5 días lees hiragana.
				</p>
			{/if}
			<p class="small muted">{planText}</p>
			<p class="small muted">
				Cada día, la página de Inicio te dirá <strong>qué hacer ahora y por qué</strong>, y en qué punto del viaje estás.
			</p>
			<InstallCard dismissible={false} />
			<div class="row">
				{#if data.diagDone}
					<button class="primary" onclick={() => finish('/leccion')} disabled={saving}>Primera lección</button>
				{:else}
					<button class="primary" onclick={() => finish(startTarget)} disabled={saving}>
						{diagScripts.length ? 'Ir a la prueba de kana' : 'Primera lección de hiragana'}
					</button>
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
	.c-kana {
		color: var(--kana);
	}
	.q {
		border: none;
		padding: 0;
		margin: 0 0 0.6rem;
	}
	.q legend {
		padding: 0;
		margin-bottom: 0.35rem;
	}
	.opts-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 0.25rem 0.75rem;
		margin: 0;
		cursor: pointer;
		color: var(--text);
	}
	.pill input {
		width: auto;
		margin: 0;
	}
	.pill.sel {
		border-color: var(--accent);
		box-shadow: inset 0 0 0 1px var(--accent);
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
