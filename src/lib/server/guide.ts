// La herramienta como guía: qué hacer ahora (y por qué) y en qué punto del viaje estás.
import { sql } from 'drizzle-orm';
import { one, type DB } from './db/index.ts';
import { knownKanji } from './items.ts';
import { lessonQuota } from './srs/lessons.ts';
import { buildProfile } from './profile.ts';
import { dayStart, getSettings } from './settings.ts';
import { hasGemini } from './gemini/client.ts';
import { leeches } from './srs/service.ts';
import { rereadsDue } from './text/library.ts';
import { reportDue } from './report.ts';

export type Step = { id: string; title: string; why: string; href: string; cta: string };

const DAY = 86_400_000;
const n = (db: DB, q: ReturnType<typeof sql>) => one<{ n: number }>(q, db)?.n ?? 0;

// ---------- Objetivo con fecha ----------

export type GoalStatus = {
	label: string;
	date: string;
	target: number;
	known: number;
	remaining: number;
	daysLeft: number;
	/** Kanji nuevos al día necesarios para llegar. */
	requiredPerDay: number;
	/** Media real de kanji nuevos al día (últimos 14 días). */
	actualPerDay: number;
	/** Fecha prevista al ritmo configurado. */
	projected: string | null;
	onTrack: boolean;
	message: string;
	textId: number | null;
} | null;

export function goalStatus(db: DB, now = new Date()): GoalStatus {
	const st = getSettings(db);
	const g = st.goal;
	if (!g) return null;
	const known = knownKanji(db).length;
	const remaining = Math.max(0, g.kanji - known);
	const deadline = new Date(`${g.date}T23:59:59`).getTime();
	const daysLeft = Math.max(0, Math.ceil((deadline - now.getTime()) / DAY));
	const learned14 = n(
		db,
		sql`select count(distinct item_key) as n from card where item_type = 'kanji' and created_at >= ${now.getTime() - 14 * DAY}`
	);
	const actualPerDay = Math.round((learned14 / 14) * 10) / 10;
	const requiredPerDay = daysLeft ? Math.ceil((remaining / daysLeft) * 10) / 10 : remaining;
	const pace = st.newKanjiPerDay;
	const projected = remaining === 0 ? null : pace > 0 ? new Date(now.getTime() + Math.ceil(remaining / pace) * DAY).toISOString().slice(0, 10) : null;
	const onTrack = remaining === 0 || (pace >= requiredPerDay && (actualPerDay >= requiredPerDay * 0.8 || learned14 === 0));
	let message: string;
	if (remaining === 0) message = '¡Conseguido! Ya tienes los kanji que necesitabas.';
	else if (!daysLeft) message = `La fecha pasó; te faltan ${remaining} kanji.`;
	else if (pace < requiredPerDay)
		message = `Necesitas ${requiredPerDay} kanji/día y tu ritmo es ${pace}. Sube el ritmo o mueve la fecha (al ritmo actual: ${projected ?? '—'}).`;
	else if (!onTrack)
		message = `Tu ritmo configurado basta (${pace}/día), pero en la práctica vas a ${actualPerDay}/día. Haz las lecciones de cada día.`;
	else message = `Vas bien: ${requiredPerDay} kanji/día necesarios, ritmo ${pace}/día. Llegada prevista: ${projected ?? g.date}.`;
	return {
		label: g.label,
		date: g.date,
		target: g.kanji,
		known,
		remaining,
		daysLeft,
		requiredPerDay,
		actualPerDay,
		projected,
		onTrack,
		message,
		textId: g.textId ?? null
	};
}

// ---------- Siguiente paso ----------

/** Pasos priorizados. El primero es "el" siguiente paso; el resto, alternativas razonables. */
export function nextSteps(db: DB, now = new Date()): Step[] {
	const steps: Step[] = [];
	const st = getSettings(db);
	const start = dayStart(now, st.dayStartHour);
	const quota = lessonQuota(db, now);
	const profile = buildProfile(db, now.getTime());
	const known = knownKanji(db).length;
	const diagDone = n(db, sql`select count(*) as n from review_log where source in ('diagnostic', 'placement')`) > 0;
	const anyCards = n(db, sql`select count(*) as n from card`) > 0;
	const readingToday = n(db, sql`select count(*) as n from reading_log where created_at >= ${start}`) > 0;
	const speedThisWeek = n(db, sql`select count(*) as n from reading_log where text_kind = 'speed' and created_at >= ${now.getTime() - 7 * DAY}`) > 0;
	const gemini = hasGemini();
	const goal = goalStatus(db, now);

	if (!st.onboardingDone && !anyCards)
		steps.push({
			id: 'welcome',
			title: 'Empieza por la bienvenida',
			why: 'En 3 minutos verás cómo funciona el método y fijarás tu ritmo diario. Todo lo demás se apoya en eso.',
			href: '/bienvenida',
			cta: 'Abrir bienvenida'
		});

	if (!diagDone)
		steps.push({
			id: 'kana',
			title: 'Haz el diagnóstico de kana',
			why: 'Los kanji se leen con kana: si dudas en ソ/ン o ぬ/め, cada lectura nueva costará el doble. El test detecta solo esos y los mete al SRS.',
			href: '/kana',
			cta: 'Diagnóstico (~5 min)'
		});

	if (reportDue(db, now.getTime()))
		steps.push({
			id: 'report',
			title: 'Tu informe semanal está listo',
			why: 'Mirar tu propia retención y velocidad una vez por semana permite ajustar el ritmo antes de que los problemas crezcan.',
			href: '/informe',
			cta: 'Ver informe'
		});

	if (profile.due > 0)
		steps.push({
			id: 'review',
			title: `Repasa ${profile.due} tarjeta${profile.due === 1 ? '' : 's'}`,
			why:
				quota.brake !== 'none'
					? `Tienes muchos repasos acumulados; por eso las lecciones están ${quota.brake === 'stop' ? 'en pausa' : 'reducidas'}. Repasar primero evita olvidar lo que ya invertiste.`
					: 'El SRS programa cada repaso justo antes de que lo olvides. Hacerlos hoy es lo que fija la memoria; lo nuevo se apoya en lo viejo.',
			href: '/repaso',
			cta: 'Empezar repaso'
		});

	const lc = leeches(db, 50);
	if (lc.length)
		steps.push({
			id: 'leeches',
			title: `${lc.length} tarjeta${lc.length === 1 ? '' : 's'} que se resiste${lc.length === 1 ? '' : 'n'}`,
			why: `Has fallado ${lc[0].display} ${lc[0].lapses} veces. Repetirla igual no funciona: cambia de estrategia (mnemotecnia nueva, contraste con su parecido o pausa).`,
			href: '/estadisticas#sanguijuelas',
			cta: 'Tratarlas'
		});

	const lessonAvail = quota.kanjiLeft > 0 || quota.vocabAvailable > 0 || quota.grammarAvailable > 0;
	if (lessonAvail)
		steps.push({
			id: 'lesson',
			title:
				quota.kanjiLeft > 0
					? `Aprende kanji nuevos (te quedan ${quota.kanjiLeft} hoy)`
					: quota.vocabAvailable > 0
						? 'Aprende vocabulario nuevo'
						: 'Aprende un punto de gramática',
			why:
				(quota.queued
					? `Tienes ${quota.queued} ítem(s) en cola del plan de un texto: entran primero. `
					: '') +
				(quota.kanjiLeft > 0
					? 'Cada lección presenta primero las piezas (componentes) y luego los kanji que las usan, en orden de frecuencia: lo más útil primero.'
					: quota.vocabAvailable > 0
						? 'Ya tienes kanji en repaso: las palabras que los usan se desbloquearon. Leer es reconocer palabras, no kanji sueltos.'
						: 'Los kanji solos no bastan: la gramática es lo que convierte palabras sueltas en frases que entiendes.'),
			href: '/leccion',
			cta: 'Empezar lección'
		});

	const rr = rereadsDue(db, now.getTime());
	if (rr.length)
		steps.push({
			id: 'reread',
			title: `Relee «${rr[0].title}»`,
			why: `Lo leíste ${rr[0].reads} vez/veces (última: ${Math.round(rr[0].lastCpm)} car/min). Releer un texto conocido mejora la fluidez más que leer siempre algo nuevo; prueba con menos furigana.`,
			href: rr[0].textKind === 'library' ? `/biblioteca/${rr[0].textId}?releer=1` : `/lectura?id=${rr[0].textId}`,
			cta: 'Releer'
		});

	if (known >= 30 && !speedThisWeek)
		steps.push({
			id: 'speed',
			title: 'Reto semanal de velocidad',
			why: 'Leer bien es leer con soltura. Medir caracteres por minuto una vez por semana muestra un progreso que el número de kanji no refleja.',
			href: '/velocidad',
			cta: 'Reto (~2 min)'
		});

	if (gemini && known >= 20 && !readingToday)
		steps.push({
			id: 'reading',
			title: 'Lee un texto a tu nivel',
			why: `Conoces ${known} kanji: suficiente para textos cortos. Leer lo aprendido en contexto es el objetivo final y consolida más que las tarjetas solas.`,
			href: '/lectura',
			cta: 'Lectura graduada'
		});

	if (goal && !goal.onTrack && goal.remaining > 0)
		steps.push({
			id: 'goal',
			title: `Objetivo «${goal.label}» en riesgo`,
			why: goal.message,
			href: '/ajustes#objetivo',
			cta: 'Ajustar ritmo'
		});

	const hard = profile.confusions.filter((c) => c.count >= 3);
	if (gemini && hard.length)
		steps.push({
			id: 'confusions',
			title: `Separa ${hard[0].a} y ${hard[0].b}`,
			why: `Los has confundido ${hard[0].count} veces. Un ejercicio de discriminación dedicado lo resuelve antes de que se vuelva costumbre.`,
			href: '/tutor?nuevo=confusiones',
			cta: 'Detective de confusiones'
		});

	if (gemini && profile.weakItems.length >= 3)
		steps.push({
			id: 'tutor',
			title: 'Practica tus puntos débiles con el tutor',
			why: `El tutor conoce tus fallos (${profile.weakItems
				.slice(0, 4)
				.map((w) => w.display)
				.join(' ')}) y te hará preguntas sobre ellos en conversación.`,
			href: '/tutor?nuevo=conversacion',
			cta: 'Conversación-quiz'
		});

	if (known >= 50 && n(db, sql`select count(*) as n from library_text`) === 0)
		steps.push({
			id: 'library',
			title: 'Trae un texto que quieras leer',
			why: 'Pega un capítulo, unos subtítulos o un EPUB: Sensei calcula cuánto entiendes y qué estudiar primero para leerlo. Motiva más que una lista.',
			href: '/biblioteca',
			cta: 'Biblioteca'
		});

	if (!steps.length)
		steps.push({
			id: 'done',
			title: 'Día completo ✓',
			why: 'No quedan repasos ni lecciones hoy. Descansar también es parte del método: el SRS te traerá lo siguiente mañana. Si quieres más, lee algo de tu biblioteca.',
			href: '/biblioteca',
			cta: 'Biblioteca'
		});
	return steps;
}

// ---------- Hitos ----------

export type Milestone = { id: string; kanji: number; title: string; unlocks: string; tip: string };

/** Cifras orientativas: un texto real necesita además vocabulario y gramática, no solo kanji. */
export const MILESTONES: Milestone[] = [
	{ id: 'm0', kanji: 0, title: 'Kana sólidos', unlocks: 'Leer cualquier texto con furigana, aunque sin entenderlo todo.', tip: 'Haz el diagnóstico de kana y repasa los dudosos hasta que salgan sin pensar.' },
	{ id: 'm50', kanji: 50, title: 'Primeros pasos', unlocks: 'Números, días, personas, «grande/pequeño», «arriba/abajo»: fechas y precios.', tip: 'Fíjate en los componentes: aparecerán en cientos de kanji más. Empieza la gramática básica (は, が, を…).' },
	{ id: 'm100', kanji: 100, title: 'Señales y menús', unlocks: 'Carteles básicos (入口, 出口, 営業中), menús sencillos, botones de juegos.', tip: 'Usa el Explicador con fotos de cosas reales y guarda frases.' },
	{ id: 'm300', kanji: 300, title: 'Manga con furigana', unlocks: 'Manga para jóvenes con furigana y diálogos de juegos sencillos: reconocerás muchas palabras.', tip: 'Trae un capítulo a la Biblioteca y estudia su plan antes de leerlo.' },
	{ id: 'm600', kanji: 600, title: 'Manga sin furigana', unlocks: 'Manga shōnen y la mayoría de interfaces de videojuegos, con diccionario ocasional.', tip: 'Furigana adaptativa y relecturas: mide tu velocidad cada semana.' },
	{ id: 'm1000', kanji: 1000, title: 'Novela ligera', unlocks: 'Novelas ligeras y webs con diccionario; noticias sencillas.', tip: 'Importa EPUB por capítulos; cada plan te prepara el siguiente.' },
	{ id: 'm2000', kanji: 2000, title: 'Lector general', unlocks: 'La lista oficial jōyō (2136) casi completa: prensa y novelas generales.', tip: 'A partir de aquí manda el vocabulario: lee mucho y añade palabras al SRS desde lo que leas.' }
];

export function journey(db: DB) {
	const known = knownKanji(db).length;
	const diagDone = n(db, sql`select count(*) as n from review_log where source in ('diagnostic', 'placement')`) > 0;
	const weakKana = n(db, sql`select count(*) as n from card where item_type = 'kana' and (state != 2 or stability < 7)`);
	const kanaOk = diagDone && weakKana === 0;
	const reached = MILESTONES.map((m) => (m.kanji === 0 ? kanaOk : known >= m.kanji));
	const currentIdx = reached.lastIndexOf(true);
	const next = MILESTONES[currentIdx + 1] ?? null;
	const prevKanji = currentIdx >= 0 ? MILESTONES[currentIdx].kanji : 0;
	return {
		known,
		kanaOk,
		milestones: MILESTONES.map((m, i) => ({ ...m, reached: reached[i] })),
		current: currentIdx >= 0 ? MILESTONES[currentIdx] : null,
		next,
		progressToNext: next ? (next.kanji === 0 ? 0 : Math.min(1, (known - prevKanji) / Math.max(1, next.kanji - prevKanji))) : 1,
		goal: goalStatus(db)
	};
}
