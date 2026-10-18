// Sesión diaria guiada (/hoy): un plan corto y ordenado de lo que toca hoy, con el tiempo estimado de cada bloque
// según tu propio ritmo, y el resumen del día para el cierre. Ver docs/daily-session.md.
import { sql } from 'drizzle-orm';
import { one, type DB } from './db/index.ts';
import { dueCount } from './srs/service.ts';
import { lessonQuota } from './srs/lessons.ts';
import { dayStart, getSettings } from './settings.ts';
import { hasGemini } from './gemini/client.ts';
import { rereadsDue } from './text/library.ts';
import { knownKanji } from './items.ts';

export type DailyStepId = 'review' | 'lesson' | 'reading' | 'close';
export type DailyStep = { id: DailyStepId; title: string; detail: string; href: string; minutes: number };
export type DailyPlan = { budget: number; minutes: number; steps: DailyStep[]; pace: Pace };
export type Pace = { secsPerReview: number; secsPerLessonItem: number; fromHistory: boolean };

export const BUDGETS = [10, 20, 40] as const;
const DEFAULT_REVIEW_SECS = 12;
const DEFAULT_LESSON_ITEM_SECS = 75;
/** Tiempo tras responder (leer la corrección, pasar a la siguiente) que `duration_ms` no mide. */
const FEEDBACK_SECS = 3;

const median = (xs: number[]) => {
	if (!xs.length) return null;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)];
};

/** Tu ritmo real: mediana de lo que tardas por repaso (últimos 30 días) y por ítem de lección. */
export function pace(db: DB, now = Date.now()): Pace {
	const since = now - 30 * 86_400_000;
	const durations = (source: string) =>
		db
			.all<{ d: number }>(
				sql`select duration_ms as d from review_log where source = ${source} and duration_ms between 500 and 120000 and reviewed_at >= ${since} order by reviewed_at desc limit 500`
			)
			.map((r) => r.d / 1000);
	const rev = median(durations('review'));
	const les = median(durations('lesson'));
	return {
		secsPerReview: rev != null ? Math.min(60, Math.max(4, rev + FEEDBACK_SECS)) : DEFAULT_REVIEW_SECS,
		// Una lección = estudiar la ficha (~1 min) + su pregunta del quiz.
		secsPerLessonItem: les != null ? 60 + Math.min(60, les + FEEDBACK_SECS) : DEFAULT_LESSON_ITEM_SECS,
		fromHistory: rev != null
	};
}

const mins = (secs: number) => Math.max(1, Math.round(secs / 60));

/** Plan de hoy para `budget` minutos: repasos (con tope) → lección → lectura corta → cierre. */
export function dailyPlan(db: DB, budget = 20, now = new Date()): DailyPlan {
	const p = pace(db, now.getTime());
	const steps: DailyStep[] = [];
	let left = budget * 60;
	const gemini = hasGemini();
	const quota = lessonQuota(db, now);
	// Quedan kanji o componentes por aprender (el cupo solo dice cuántos se pueden hoy, no si existen).
	const kanjiToLearn =
		quota.kanjiLeft > 0 &&
		(one<{ n: number }>(
			sql`select exists(select 1 from kanji where learn_order is not null and not exists (select 1 from card where item_type = 'kanji' and item_key = kanji.char)) as n`,
			db
		)?.n ?? 0) > 0;
	const lessonAvail = quota.brake !== 'stop' && (kanjiToLearn || quota.vocabAvailable > 0 || quota.grammarAvailable > 0);

	// 1) Repasos: primero, pero sin comerse toda la sesión si hay lecciones (deja ~40 % para lo demás).
	const due = dueCount(db, now.getTime());
	if (due > 0) {
		const share = lessonAvail ? 0.6 : 0.85;
		const cap = Math.max(10, Math.floor((left * share) / p.secsPerReview));
		const n = Math.min(due, cap);
		steps.push({
			id: 'review',
			title: `Repasar ${n} tarjeta${n === 1 ? '' : 's'}`,
			detail: n < due ? `De ${due} pendientes: el resto, mañana o en otra sesión. Mejor pocas cada día que muchas de golpe.` : 'Todo lo pendiente de hoy.',
			href: `/repaso?hoy=1&limite=${n}`,
			minutes: mins(n * p.secsPerReview)
		});
		left -= n * p.secsPerReview;
	}

	// 2) Lección (si queda tiempo para al menos unos ítems).
	if (lessonAvail && left >= 4 * 60) {
		const items = Math.min(
			(kanjiToLearn ? quota.kanjiLeft : 0) + Math.min(quota.vocabLeft, 5) + Math.min(quota.grammarLeft, 1),
			Math.floor(left / p.secsPerLessonItem)
		);
		if (items > 0) {
			steps.push({
				id: 'lesson',
				title: 'Lección nueva',
				detail:
					kanjiToLearn
						? `Componentes y kanji nuevos (te quedan ${quota.kanjiLeft} hoy), con su mini-quiz.`
						: quota.vocabAvailable > 0
							? 'Vocabulario nuevo con los kanji que ya repasas.'
							: 'Un punto de gramática.',
				href: '/leccion?hoy=1',
				minutes: mins(items * p.secsPerLessonItem)
			});
			left -= items * p.secsPerLessonItem;
		}
	}

	// 3) Lectura corta: relectura que toca > lectura graduada > reto de velocidad > un texto de la biblioteca.
	if (left >= 3 * 60) {
		const known = knownKanji(db).length;
		const rr = rereadsDue(db, now.getTime());
		const lib = one<{ id: number; title: string }>(sql`select id, title from library_text order by created_at desc limit 1`, db);
		const reading: Omit<DailyStep, 'minutes'> | null = rr.length
			? {
					id: 'reading',
					title: `Releer «${rr[0].title}»`,
					detail: 'Releer algo conocido da fluidez. Prueba con menos furigana.',
					href: rr[0].textKind === 'library' ? `/biblioteca/${rr[0].textId}?releer=1&hoy=1` : `/lectura?id=${rr[0].textId}&hoy=1`
				}
			: gemini && known >= 20
				? { id: 'reading', title: 'Lectura a tu nivel', detail: 'Un texto corto con lo que ya sabes y un poco nuevo.', href: '/lectura?hoy=1' }
				: known >= 30
					? { id: 'reading', title: 'Reto de velocidad', detail: 'Frases con kanji que ya conoces, cronometradas.', href: '/velocidad?hoy=1' }
					: lib
						? { id: 'reading', title: `Leer «${lib.title}»`, detail: 'Un rato con tu texto de la biblioteca.', href: `/biblioteca/${lib.id}?hoy=1` }
						: null;
		if (reading) {
			const m = Math.min(5, Math.floor(left / 60));
			steps.push({ ...reading, minutes: m });
			left -= m * 60;
		}
	}

	// 4) Cierre: con el tutor (si hay key) o un resumen local.
	if (steps.length)
		steps.push({
			id: 'close',
			title: gemini ? 'Cierre con el tutor' : 'Resumen del día',
			detail: gemini ? 'Comenta contigo lo de hoy y qué viene mañana (unas líneas; sigue si quieres).' : 'Lo que hiciste hoy, en números.',
			href: gemini ? '/tutor/nueva?modo=cierre&hoy=1' : '/hoy?resumen=1',
			minutes: gemini ? 2 : 1
		});

	return { budget, minutes: steps.reduce((a, s) => a + s.minutes, 0), steps, pace: p };
}

export type DaySummary = {
	reviews: number;
	correct: number;
	accuracy: number | null;
	newCards: number;
	readings: number;
	readingChars: number;
	minutes: number;
	due: number;
	tomorrow: number;
};

/** Lo hecho hoy (desde la hora de inicio del día configurada). */
export function daySummary(db: DB, now = new Date()): DaySummary {
	const start = dayStart(now, getSettings(db).dayStartHour);
	const r = one<{ n: number; ok: number; ms: number }>(
		sql`select count(*) as n, coalesce(sum(correct), 0) as ok, coalesce(sum(min(coalesce(duration_ms, 0), 120000)), 0) as ms from review_log where reviewed_at >= ${start} and source in ('review', 'lesson')`,
		db
	) ?? { n: 0, ok: 0, ms: 0 };
	const newCards = one<{ n: number }>(sql`select count(*) as n from card where created_at >= ${start}`, db)?.n ?? 0;
	const rd = one<{ n: number; c: number; ms: number }>(
		sql`select count(*) as n, coalesce(sum(chars), 0) as c, coalesce(sum(duration_ms), 0) as ms from reading_log where created_at >= ${start}`,
		db
	) ?? { n: 0, c: 0, ms: 0 };
	const tomorrowEnd = start + 2 * 86_400_000;
	return {
		reviews: r.n,
		correct: r.ok,
		accuracy: r.n ? Math.round((r.ok / r.n) * 100) : null,
		newCards,
		readings: rd.n,
		readingChars: rd.c,
		minutes: Math.round((r.ms + r.n * FEEDBACK_SECS * 1000 + rd.ms) / 60000),
		due: dueCount(db, now.getTime()),
		tomorrow: dueCount(db, tomorrowEnd) - dueCount(db, now.getTime())
	};
}

/** Texto del resumen para el cierre con el tutor (contexto de pantalla). */
export function summaryText(s: DaySummary) {
	return [
		`Repasos y preguntas de lección hoy: ${s.reviews} (${s.accuracy ?? '—'} % correctas)`,
		`Tarjetas nuevas: ${s.newCards}`,
		s.readings ? `Lecturas cronometradas: ${s.readings} (${s.readingChars} caracteres)` : 'Sin lectura cronometrada hoy',
		`Tiempo aproximado: ${s.minutes} min`,
		`Pendientes ahora: ${s.due}; mañana vencen unas ${Math.max(0, s.tomorrow)} más`
	].join('\n');
}
