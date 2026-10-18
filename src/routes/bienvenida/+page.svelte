<script lang="ts">
	import { toast } from '#lib/client/toast.svelte.ts';
	import { goto } from '#lib/client/nav.ts';
	import { onMount, untrack } from 'svelte';
	import { disableReminder, enableReminder, reminderEnabled, reminderSupport, testNotification } from '#lib/client/reminder.ts';
	import type { PageProps } from './$types';
	import { post, errMsg } from '#lib/client/api.ts';
	import InstallCard from '#lib/components/InstallCard.svelte';
	import ProgressSteps, { type StepState } from '#lib/components/ProgressSteps.svelte';
	import { aiKey, aiMode, aiNews, setAiMode } from '#lib/client/ai.svelte.ts';
	import { setTheme, theme, type ThemeMode } from '#lib/client/theme.svelte.ts';
	import { MODE_DESC } from '#lib/tutorModes.ts';
	import { refreshAll } from '$app/navigation';
	import { base } from '#lib/client/base.ts';
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

	// «Configurar Gemini» solo existe si eliges usar la IA.
	const STEPS = $derived([
		'Bienvenida',
		'Apariencia',
		'El camino',
		'Tu punto de partida',
		'El SRS',
		'Tu ritmo',
		'Leer sin muletas',
		'La IA',
		...(aiMode() === 'on' ? ['Configurar Gemini'] : []),
		'¡A empezar!'
	]);
	const last = $derived(STEPS.length - 1);
	const at = (name: string) => STEPS[step] === name;

	// ---------- Recordatorio ----------
	let notifSupported = $state(false);
	let notifPeriodic = $state(true);
	let notif = $state<'on' | 'off' | null>(null);
	let notifBusy = $state(false);
	let notifMsg = $state('');
	onMount(() => {
		const sup = reminderSupport();
		notifSupported = sup.notifications;
		notifPeriodic = sup.periodic;
		if (reminderEnabled() && Notification.permission === 'granted') notif = 'on';
	});
	async function chooseNotif(yes: boolean) {
		notifBusy = true;
		try {
			if (yes) {
				// Al pulsar (gesto del usuario): así el navegador deja pedir el permiso.
				const r = await enableReminder();
				notif = r.ok ? 'on' : null;
				notifMsg = r.ok ? `✓ ${r.message}` : r.message;
				if (r.ok) await testNotification();
			} else {
				await disableReminder();
				notif = 'off';
				notifMsg = '';
			}
		} finally {
			notifBusy = false;
		}
	}

	// ---------- Apariencia ----------
	const THEMES: { v: ThemeMode; label: string; desc: string }[] = [
		{ v: 'light', label: 'Claro', desc: 'Fondo claro siempre' },
		{ v: 'dark', label: 'Oscuro', desc: 'Fondo oscuro siempre' },
		{ v: 'system', label: 'Sistema', desc: 'Sigue el de tu dispositivo' }
	];

	// ---------- IA ----------
	/**
	 * Opción elegida en «La IA». Por defecto «Sin IA» (marcada), salvo que ya hubiera elegido IA o tenga key. Se guarda al
	 * pulsar «Siguiente», no al tocarla.
	 */
	let aiPick = $state<'on' | 'off'>(untrack(() => (aiMode() === 'on' || (aiMode() === 'ask' && aiKey()) ? 'on' : 'off')));
	/** Al activar la IA aquí, las novedades se muestran al salir de «Configurar Gemini». */
	let announceAi = false;
	let aiBusy = $state(false);

	/** «Siguiente»: guarda lo que pide el paso actual y avanza. */
	async function next() {
		if (at('La IA')) {
			aiBusy = true;
			try {
				if (aiPick !== aiMode()) {
					announceAi = aiPick === 'on';
					await setAiMode(aiPick, { announce: false });
				}
			} catch (e) {
				toast.error('No se pudo guardar', { detail: errMsg(e) });
				return;
			} finally {
				aiBusy = false;
			}
		}
		const leavingGemini = at('Configurar Gemini');
		step++;
		if (leavingGemini && announceAi) {
			announceAi = false;
			aiNews.open = true;
		}
	}
	const keyOrigin = typeof location !== 'undefined' ? `${location.origin}${base}/*` : '';
	let apiKey = $state('');
	let keyBusy = $state(false);
	let keyError = $state('');
	async function saveKey() {
		keyBusy = true;
		keyError = '';
		try {
			const r = await post<{ models: number }>('/api/gemini-key', { key: apiKey.trim() });
			apiKey = '';
			toast.success('API key guardada', { detail: `Gemini responde: ${r.models} modelos disponibles.` });
			await refreshAll();
		} catch (e) {
			const m = errMsg(e);
			keyError = /api key not valid|invalid/i.test(m)
				? 'Google no acepta esa key. Comprueba que la copiaste entera (empieza por AIza…) y que es de Google AI Studio.'
				: m;
		} finally {
			keyBusy = false;
		}
	}

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

	/**
	 * Al terminar: guardar y abrir la primera pantalla. Abrirla (sobre todo Inicio) calcula tu plan, progreso y siguiente
	 * paso y puede tardar un momento: mientras, se muestra el progreso como en la instalación (ProgressSteps).
	 */
	let finishing = $state<{ phase: 'save' | 'load'; dest: string } | null>(null);
	const DEST: Record<string, string> = { '/': 'tu inicio', '/leccion': 'tu primera lección' };
	const finishSteps = $derived.by(() => {
		if (!finishing) return [];
		const load = finishing.phase === 'load';
		return [
			{ label: 'Guardar tu configuración', state: (load ? 'done' : 'now') as StepState },
			{ label: `Preparar ${finishing.dest}`, state: (load ? 'now' : 'todo') as StepState }
		];
	});
	async function finish(target: string) {
		saving = true;
		finishing = { phase: 'save', dest: DEST[target] ?? (target.startsWith('/kana') ? 'la prueba de kana' : 'la siguiente pantalla') };
		try {
			await post('/api/settings', {
				newKanjiPerDay: pace,
				newVocabPerDay: pace,
				newGrammarPerDay: pace >= 15 ? 3 : 2,
				furigana,
				startLevel: level,
				onboardingDone: true
			});
			finishing = { ...finishing, phase: 'load' };
			await goto(target, { refreshAll: true });
		} catch (e) {
			toast.error('No se pudo guardar tu ritmo', { detail: errMsg(e) });
			saving = false;
			finishing = null;
		}
	}
</script>

<svelte:head><title>Bienvenida · Sensei</title></svelte:head>

{#if finishing}
	<!-- Mientras se guarda y carga la primera pantalla: el mismo progreso que la instalación inicial. -->
	<div class="wiz">
		<div class="card stack page">
			<h2><span class="jp accent">先生</span> ¡Listo!</h2>
			<ProgressSteps
				steps={finishSteps}
				note={finishing.phase === 'load' ? 'Calculando tu plan, tu progreso y tu siguiente paso…' : ''}
				progress={null}
			/>
		</div>
	</div>
{:else}
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
		{:else if at('Apariencia')}
			<h2>¿Cómo prefieres verla?</h2>
			<p class="muted small">Se aplica al instante y solo en este dispositivo. Puedes cambiarlo cuando quieras desde el menú (☀/☾/◐).</p>
			<div class="themes" role="radiogroup" aria-label="Tema">
				{#each THEMES as t (t.v)}
					<button class="opt theme-opt" class:sel={theme.mode === t.v} role="radio" aria-checked={theme.mode === t.v} onclick={() => setTheme(t.v)}>
						<!-- Vista previa: colores fijos de cada tema (en «Sistema», mitad y mitad). -->
						<span class="preview p-{t.v}" aria-hidden="true">
							<span class="pv-bar"></span><span class="pv-line"></span><span class="pv-line short"></span><span class="pv-chip jp">あ</span>
						</span>
						<strong>{t.label}</strong>
						<span class="small dim">{t.desc}</span>
					</button>
				{/each}
			</div>
		{:else if at('El camino')}
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
		{:else if at('Tu punto de partida')}
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
		{:else if at('El SRS')}
			<h2>El SRS: repasar justo antes de olvidar</h2>
			<div class="simple">
				<p>
					<strong>SRS</strong> = <em>sistema de repetición espaciada</em>. Es el método: cada cosa vuelve justo cuando estás a punto de
					olvidarla. Lo que sabes bien aparece cada vez menos; lo que fallas, pronto. Así repasas poco y recuerdas mucho.
				</p>
				<p>
					<strong>FSRS</strong> es el algoritmo que usa Sensei para elegir ese momento: aprende de tus respuestas cuánto te dura cada
					recuerdo y calcula la fecha del próximo repaso de cada tarjeta.
				</p>
			</div>
			<p>
				Cada cosa que aprendes se convierte en tarjetas (significado y lectura). Al principio vuelven en minutos, luego en días, luego en
				semanas y meses.
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
		{:else if at('Tu ritmo')}
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
			{#if notifSupported}
				<div class="notif stack">
					<strong>¿Quieres un recordatorio de repasos?</strong>
					<p class="small muted">
						Como mucho un aviso al día (entre las 8 y las 22 h) si tienes repasos pendientes. El navegador te pedirá permiso.
						{#if !notifPeriodic}En este navegador el aviso solo llega con la app instalada y abierta a menudo (Chrome/Edge); si no, verás los pendientes al abrirla.{/if}
					</p>
					<!-- Sin opción por defecto. -->
					<div class="choice-row" role="radiogroup" aria-label="Recordatorio de repasos">
						<button class="opt" class:sel={notif === 'on'} role="radio" aria-checked={notif === 'on'} onclick={() => chooseNotif(true)} disabled={notifBusy}>
							<strong>{#if notifBusy}<span class="spinner"></span>{/if} Sí, avisarme</strong>
							<span class="small dim">Puedes probarlo o quitarlo en Ajustes → App</span>
						</button>
						<button class="opt" class:sel={notif === 'off'} role="radio" aria-checked={notif === 'off'} onclick={() => chooseNotif(false)} disabled={notifBusy}>
							<strong>No, gracias</strong>
							<span class="small dim">Sin avisos</span>
						</button>
					</div>
					{#if notifMsg}<p class="small" class:warning={notif !== 'on'}>{notifMsg}</p>{/if}
				</div>
			{/if}
		{:else if at('Leer sin muletas')}
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
		{:else if at('La IA')}
			<h2>¿Quieres usar IA?</h2>
			<p>
				<strong>Sensei funciona entero sin IA</strong> y no la incluye. Opcionalmente puedes conectarle <strong>Gemini</strong>, la IA de
				Google, con <strong>tu propia API key</strong> (una clave personal que creas tú en tu cuenta de Google).
			</p>
			<div class="ai-cols">
				<div class="ai-col">
					<h3>Qué añade</h3>
					<ul class="small">
						<li>Un <strong>tutor personal</strong> que conoce tu progreso, tus fallos y confusiones, y recuerda las sesiones anteriores.</li>
						<li><strong>Lecturas graduadas</strong> a tu nivel y un <strong>explicador</strong> de frases o fotos de manga.</li>
						<li><strong>«¿Por qué?»</strong> al fallar un repaso y mnemotecnias para los kanji que aún no traen.</li>
					</ul>
				</div>
				<div class="ai-col">
					<h3>Qué necesitas</h3>
					<ul class="small">
						<li>Una <strong>cuenta de Google</strong> y unos 2 minutos para crear la key (te guío en el paso siguiente).</li>
						<li><strong>Costo:</strong> Google ofrece un uso gratuito limitado; por encima, lo cobra a tu cuenta según su plan. Sensei te muestra el gasto estimado y puedes ponerle un presupuesto.</li>
						<li>La key se guarda <strong>solo en este navegador</strong>.</li>
					</ul>
				</div>
			</div>
			<details class="tutor-more">
				<summary>Ver todo lo que hace el tutor</summary>
				<div class="stack small">
					<p>
						Es un profesor de japonés en español que <strong>ve tu progreso real</strong>: qué kanji y palabras estudias, cuáles fallas,
						qué confundes, tu gramática y tu ritmo. No te pregunta lo que aún no viste y vuelve sobre lo que se te resiste.
					</p>
					<h4>Modos</h4>
					<ul>
						<li><strong>Conversación-quiz</strong> — {MODE_DESC.conversacion} <span class="dim">Ej.: «pregúntame por los kanji de esta semana».</span></li>
						<li><strong>Quiz a medida</strong> — {MODE_DESC.quiz} <span class="dim">Ej.: «10 preguntas de palabras con 氵».</span></li>
						<li><strong>Explicador</strong> — {MODE_DESC.explicador} <span class="dim">Ej.: pega 「もう食べた？」 y te la desglosa.</span></li>
						<li><strong>Detective de confusiones</strong> — {MODE_DESC.confusiones} <span class="dim">Ej.: 未 / 末, ソ / ン.</span></li>
						<li><strong>Libre</strong> — {MODE_DESC.libre} <span class="dim">Ej.: «¿qué estudio antes de leer este manga?».</span></li>
					</ul>
					<h4>Además</h4>
					<ul>
						<li><strong>En cualquier pantalla</strong>: el botón 話 abre el tutor sabiendo qué estás viendo (la ficha de un kanji, un repaso fallado, un texto).</li>
						<li><strong>Actúa por ti</strong>, siempre a la vista: añade palabras a tu cola, pone frases en el SRS o propone cambiar tu ritmo. Lo directo trae «Deshacer»; lo importante pide «Confirmar». Nunca borra tu progreso.</li>
						<li><strong>Recuerda</strong>: resume cada sesión y guarda notas sobre ti (intereses, dificultades) para la próxima.</li>
						<li><strong>Con voz</strong>: le hablas en español o japonés, te responde en voz alta y, en manos libres, la conversación sigue sola.</li>
						<li><strong>Cierre del día</strong>: en la sesión de hoy comenta contigo lo que hiciste y qué viene mañana.</li>
						<li>Sus lecturas se comprueban contra el diccionario: si algo no cuadra, lo marca.</li>
					</ul>
				</div>
			</details>
			<p class="small muted">Sin IA: SRS, kana, lecciones, diccionario, biblioteca, velocidad e informes funcionan igual, con el contenido ya preparado.</p>
			<!-- Sin IA primero y marcada por defecto; se guarda al pulsar «Siguiente». -->
			<div class="choice-row" role="radiogroup" aria-label="Usar IA">
				<button class="opt" class:sel={aiPick === 'off'} role="radio" aria-checked={aiPick === 'off'} onclick={() => (aiPick = 'off')} disabled={aiBusy}>
					<strong>Sin IA</strong>
					<span class="small dim">Todo listo sin configurar nada. Puedes activarla cuando quieras en Ajustes</span>
				</button>
				<button class="opt" class:sel={aiPick === 'on'} role="radio" aria-checked={aiPick === 'on'} onclick={() => (aiPick = 'on')} disabled={aiBusy}>
					<strong>Usar Gemini</strong>
					<span class="small dim">Con tu API key: te guío para crearla en el paso siguiente</span>
				</button>
			</div>
		{:else if at('Configurar Gemini')}
			<h2>Configurar Gemini</h2>
			{#if aiKey()}
				<p>✓ <strong>Tu API key está guardada y funciona.</strong> Ya puedes usar el tutor y el resto de funciones de IA.</p>
				<p class="small muted">Puedes cambiarla o quitarla cuando quieras en Ajustes → API key de Gemini.</p>
			{:else}
				<ol class="howto">
					<li>
						Abre <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio → API keys</a> e inicia
						sesión con tu cuenta de Google. La primera vez te pide aceptar sus condiciones.
					</li>
					<li>Pulsa <strong>«Create API key»</strong> (Crear clave de API). Si te pregunta por un proyecto, elige el que ofrece o crea uno nuevo.</li>
					<li>Copia la clave: es un texto largo que empieza por <code>AIza…</code>.</li>
					<li>Pégala aquí y pulsa <strong>Probar y guardar</strong>: Sensei comprueba que funciona antes de guardarla.</li>
				</ol>
				<div class="row">
					<input
						class="grow"
						type="password"
						bind:value={apiKey}
						placeholder="Pega tu API key (AIza…)"
						autocomplete="off"
						aria-invalid={!!keyError}
						oninput={() => (keyError = '')}
					/>
					<button class="primary" onclick={saveKey} disabled={keyBusy || !apiKey.trim()}>
						{#if keyBusy}<span class="spinner"></span>{/if} Probar y guardar
					</button>
				</div>
				{#if keyError}<p class="small warning">{keyError}</p>{/if}
				<details class="small">
					<summary>Recomendado: protege tu key</summary>
					<ul>
						<li>Se guarda solo en este navegador, pero cualquiera con acceso a él podría usarla.</li>
						<li>
							En <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Google Cloud → Credenciales</a>,
							restríngela a esta dirección (<code>{keyOrigin}</code>) y a la «Generative Language API».
						</li>
						<li>Después, en Sensei → Costos, ponle un presupuesto mensual.</li>
					</ul>
				</details>
				<p class="small muted">¿Ahora no? Pulsa «Siguiente»: la pegarás luego en Ajustes. Hasta entonces, las funciones de IA no funcionarán.</p>
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
			<button class="primary" onclick={next} disabled={aiBusy}>{#if aiBusy}<span class="spinner"></span>{/if} Siguiente →</button>
		{:else}
			<span></span>
		{/if}
	</div>
</div>
{/if}

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
	.ai-cols {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 0.4rem 1.2rem;
	}
	.ai-col h3 {
		margin: 0 0 0.2rem;
		font-size: 1rem;
	}
	.ai-col ul {
		margin: 0;
		padding-left: 1.1rem;
		display: grid;
		gap: 0.25rem;
	}
	.choice-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.6rem;
	}
	.opt {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.2rem;
		padding: 0.8rem 0.9rem;
		text-align: left;
	}
	.opt.sel {
		border-color: var(--accent);
		box-shadow: inset 0 0 0 1px var(--accent);
	}
	.notif {
		border-top: 1px solid var(--line);
		padding-top: 0.8rem;
		margin-top: 0.4rem;
		gap: 0.5rem;
	}
	.notif p {
		margin: 0;
	}
	.simple {
		background: var(--bg-3);
		border-left: 3px solid var(--series-1);
		border-radius: var(--radius-sm);
		padding: 0.6rem 0.8rem;
	}
	.simple p {
		margin: 0.2rem 0;
	}
	.tutor-more summary {
		cursor: pointer;
		font-weight: 600;
	}
	.tutor-more h4 {
		margin: 0.4rem 0 0;
		font-size: 0.95rem;
	}
	.tutor-more ul {
		margin: 0;
		padding-left: 1.1rem;
		display: grid;
		gap: 0.3rem;
	}
	.tutor-more p {
		margin: 0.4rem 0 0;
	}
	.themes {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 0.6rem;
	}
	.theme-opt {
		align-items: stretch;
	}
	/* Vistas previas con los colores de cada tema (fijos a propósito: muestran el otro tema aunque estés en este). */
	.preview {
		display: grid;
		gap: 0.3rem;
		padding: 0.5rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		margin-bottom: 0.35rem;
		position: relative;
		height: 4.4rem;
	}
	.p-light {
		background: #f6f5f1;
		--pv-ink: #1d1f24;
		--pv-mute: #d6d3cb;
	}
	.p-dark {
		background: #14161b;
		--pv-ink: #e8e9ec;
		--pv-mute: #2e3340;
	}
	.p-system {
		background: linear-gradient(135deg, #f6f5f1 50%, #14161b 50%);
		--pv-ink: #8a8f99;
		--pv-mute: #8a8f9955;
	}
	.pv-bar {
		height: 0.45rem;
		width: 55%;
		border-radius: 999px;
		background: var(--accent);
	}
	.pv-line {
		height: 0.35rem;
		border-radius: 999px;
		background: var(--pv-mute);
	}
	.pv-line.short {
		width: 60%;
	}
	.pv-chip {
		position: absolute;
		right: 0.5rem;
		bottom: 0.4rem;
		color: var(--pv-ink);
		font-size: 1.1rem;
	}
	.howto {
		margin: 0;
		padding-left: 1.3rem;
		display: grid;
		gap: 0.45rem;
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
