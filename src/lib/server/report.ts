// Informe semanal (metacognición): métricas locales + lectura del tutor con sugerencias concretas.
import { desc, gte, sql } from 'drizzle-orm';
import { one, type DB } from './db/index.ts';
import * as s from './db/schema.ts';
import { getSettings, dayStart } from './settings.ts';
import { generateText, hasGemini, models } from './gemini/client.ts';
import { addNote } from './profile.ts';
import { leeches } from './srs/service.ts';
import { goalStatus } from './guide.ts';

const DAY = 86_400_000;
const TYPE_ES: Record<string, string> = {
	kana: 'kana',
	component: 'componentes',
	kanji: 'kanji',
	vocab: 'vocabulario',
	grammar: 'gramática',
	sentence: 'frases'
};

export type WeekMetrics = {
	from: number;
	to: number;
	reviews: number;
	minutes: number;
	activeDays: number;
	newItems: Record<string, number>;
	/** Retención real en repasos espaciados (≥1 día desde el anterior), por tipo y faceta. */
	retention: { key: string; label: string; n: number; rate: number }[];
	cpm: { avg: number | null; prevAvg: number | null; reads: number };
	newConfusions: { a: string; b: string; count: number }[];
	leeches: number;
	goal: ReturnType<typeof goalStatus>;
	desiredRetention: number;
};

export function weekMetrics(db: DB, now = new Date()): WeekMetrics {
	const st = getSettings(db);
	const to = dayStart(now, st.dayStartHour) + DAY;
	const from = to - 7 * DAY;
	const tot = one<{ n: number; ms: number; days: number }>(
		sql`select count(*) as n, coalesce(sum(duration_ms), 0) as ms,
		    count(distinct date(reviewed_at / 1000, 'unixepoch', 'localtime')) as days
		    from review_log where reviewed_at >= ${from} and reviewed_at < ${to}`,
		db
	);
	const newRows = db.all<{ t: string; n: number }>(
		sql`select item_type as t, count(distinct item_key) as n from card where created_at >= ${from} and created_at < ${to} group by item_type`
	);
	// Retención: respuestas de repaso cuyo intervalo previo fue ≥ 1 día (las de aprendizaje inicial no cuentan).
	const ret = db.all<{ t: string; f: string; n: number; ok: number }>(sql`
		select r.item_type as t, r.facet as f, count(*) as n, sum(r.correct) as ok
		from review_log r
		where r.source = 'review' and r.reviewed_at >= ${from} and r.reviewed_at < ${to}
			and exists (select 1 from review_log p where p.card_id = r.card_id and p.reviewed_at < r.reviewed_at - ${DAY})
		group by r.item_type, r.facet having n >= 5
	`);
	const cpmRows = (a: number, b: number) =>
		one<{ avg: number | null; n: number }>(
			sql`select avg(cpm) as avg, count(*) as n from reading_log where created_at >= ${a} and created_at < ${b}`,
			db
		);
	const cur = cpmRows(from, to);
	const prev = cpmRows(from - 7 * DAY, from);
	return {
		from,
		to,
		reviews: tot?.n ?? 0,
		minutes: Math.round((tot?.ms ?? 0) / 60000),
		activeDays: tot?.days ?? 0,
		newItems: Object.fromEntries(newRows.map((r) => [r.t, r.n])),
		retention: ret.map((r) => ({
			key: `${r.t}:${r.f}`,
			label: `${TYPE_ES[r.t] ?? r.t} · ${r.f === 'meaning' ? 'significado' : 'lectura'}`,
			n: r.n,
			rate: Math.round((r.ok / r.n) * 100) / 100
		})),
		cpm: { avg: cur?.avg ? Math.round(cur.avg) : null, prevAvg: prev?.avg ? Math.round(prev.avg) : null, reads: cur?.n ?? 0 },
		newConfusions: db
			.select({ a: s.confusion.a, b: s.confusion.b, count: s.confusion.count })
			.from(s.confusion)
			.where(gte(s.confusion.lastAt, from))
			.orderBy(desc(s.confusion.count))
			.limit(5)
			.all(),
		leeches: leeches(db, 100).length,
		goal: goalStatus(db, now),
		desiredRetention: st.desiredRetention
	};
}

/** Texto sin IA (respaldo) con las mismas reglas que se piden al tutor. */
function fallbackText(m: WeekMetrics) {
	const lines: string[] = [];
	lines.push(`**Semana:** ${m.reviews} respuestas en ${m.activeDays} día(s), ~${m.minutes} min.`);
	const news = Object.entries(m.newItems)
		.map(([t, n]) => `${n} ${TYPE_ES[t] ?? t}`)
		.join(', ');
	if (news) lines.push(`**Nuevo:** ${news}.`);
	for (const r of m.retention) {
		const pct = Math.round(r.rate * 100);
		const target = Math.round(m.desiredRetention * 100);
		lines.push(`- Retención en ${r.label}: ${pct}% (objetivo ${target}%)${pct < target - 5 ? ' ⚠' : ''}`);
	}
	const low = m.retention.filter((r) => r.rate < m.desiredRetention - 0.05);
	if (low.length) lines.push('**Sugerencia:** baja el ritmo de lecciones unos días y repasa con atención lo que más fallas.');
	if (m.activeDays < 5) lines.push('**Sugerencia:** intenta repasar todos los días, aunque sean 5 minutos: la constancia pesa más que la cantidad.');
	if (m.cpm.avg) lines.push(`**Velocidad de lectura:** ${m.cpm.avg} caracteres/min${m.cpm.prevAvg ? ` (semana anterior: ${m.cpm.prevAvg})` : ''}.`);
	if (m.newConfusions.length) lines.push(`**Confusiones nuevas:** ${m.newConfusions.map((c) => `${c.a}/${c.b}`).join(', ')}.`);
	if (m.leeches) lines.push(`**Tarjetas que se resisten:** ${m.leeches}. Trátalas desde Estadísticas.`);
	if (m.goal) lines.push(`**Objetivo «${m.goal.label}»:** ${m.goal.message}`);
	return lines.join('\n');
}

export async function generateWeeklyReport(db: DB, now = new Date()) {
	const m = weekMetrics(db, now);
	let text = fallbackText(m);
	if (hasGemini()) {
		try {
			text = await generateText({
				db,
				feature: 'report',
				model: models(db).flash,
				system:
					'Eres el tutor de lectura de japonés del alumno. Escribe su informe semanal en español: breve (máx. 180 palabras), ' +
					'concreto y honesto, en Markdown. Estructura: 1) qué fue bien, 2) qué preocupa (con cifras), 3) 2-3 sugerencias ACCIONABLES ' +
					'(p. ej. «bajar a 8 kanji/día una semana», «practicar 待/持 en el detective de confusiones»). Usa {漢字|かな} si escribes japonés.',
				contents: `Métricas de la semana (JSON):\n${JSON.stringify(m)}\n\nRetención objetivo del SRS: ${Math.round(m.desiredRetention * 100)}%.`,
				temperature: 0.4
			});
		} catch {
			/* se queda el texto de respaldo */
		}
	}
	const row = db
		.insert(s.weeklyReport)
		.values({ weekStart: m.from, metrics: m as unknown as Record<string, unknown>, text, createdAt: Date.now() })
		.returning()
		.get();
	// Memoria del tutor: una línea por semana.
	addNote(db, `Informe semana ${new Date(m.from).toLocaleDateString('es')}: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
	return row;
}

export function latestReport(db: DB) {
	return db.select().from(s.weeklyReport).orderBy(desc(s.weeklyReport.createdAt)).limit(1).get() ?? null;
}

export function listReports(db: DB, limit = 12) {
	return db.select().from(s.weeklyReport).orderBy(desc(s.weeklyReport.createdAt)).limit(limit).all();
}

/** ¿Toca informe? Uno cada 7 días si hubo actividad. */
export function reportDue(db: DB, now = Date.now()) {
	const last = latestReport(db);
	if (last && now - last.createdAt < 7 * DAY) return false;
	const since = last?.createdAt ?? now - 7 * DAY;
	const firstActivity = one<{ t: number | null }>(sql`select min(reviewed_at) as t from review_log`, db)?.t;
	if (!firstActivity || now - firstActivity < 6 * DAY) return false; // al menos una semana de uso
	return (one<{ n: number }>(sql`select count(*) as n from review_log where reviewed_at >= ${since}`, db)?.n ?? 0) > 0;
}
