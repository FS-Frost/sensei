import { sql } from 'drizzle-orm';
import { db, one } from '#lib/server/db/index.ts';
import { buildProfile } from '#lib/server/profile.ts';
import { lessonQuota } from '#lib/server/srs/lessons.ts';
import { forecast } from '#lib/server/srs/service.ts';
import { dayStart, getSettings } from '#lib/server/settings.ts';
import { listSessions } from '#lib/server/gemini/tutor.ts';
import { journey, nextSteps } from '#lib/server/guide.ts';
import { budgetStatus } from '#lib/server/gemini/usage.ts';
import { redirect } from '#lib/server/router.ts';
import { dailyPlan } from '#lib/server/daily.ts';

export const load = () => {
	const now = new Date();
	const st = getSettings(db);
	const anyCards = (one<{ n: number }>(sql`select count(*) as n from card`)?.n ?? 0) > 0;
	// Primera vez (sin progreso): la bienvenida explica el método antes de nada.
	if (!st.onboardingDone && !anyCards) redirect(303, '/bienvenida');
	const start = dayStart(now, st.dayStartHour);
	const profile = buildProfile(db, now.getTime());
	const totals = one<{ kanji: number }>(sql`select count(*) as kanji from kanji where learn_order is not null`);
	const kanaCards = one<{ n: number }>(sql`select count(*) as n from card where item_type = 'kana'`)?.n ?? 0;
	const kanaDiagDone = (one<{ n: number }>(sql`select count(*) as n from review_log where source = 'diagnostic'`)?.n ?? 0) > 0;
	const days = 7;
	const fc = forecast(db, start, days);
	return {
		profile,
		quota: lessonQuota(db, now),
		totalKanji: totals?.kanji ?? 0,
		kanaCards,
		kanaDiagDone,
		forecast: {
			labels: Array.from({ length: days }, (_, i) =>
				i === 0 ? 'hoy' : new Date(start + i * 86_400_000).toLocaleDateString('es', { weekday: 'short' })
			),
			values: fc
		},
		sessions: listSessions(db, 4),
		steps: nextSteps(db, now),
		journey: journey(db),
		onboardingDone: st.onboardingDone,
		budget: budgetStatus(db, now),
		// Sesión de hoy con el tiempo por defecto (20 min): para el botón de Inicio.
		daily: (({ minutes, steps }) => ({ minutes, steps: steps.length }))(dailyPlan(db, 20, now))
	};
};
