import { eq, sql } from 'drizzle-orm';
import type { DB } from './db/index.ts';
import { setting } from './db/schema.ts';

import type { FuriganaMode } from '../types.ts';
import { normalizePrices, type ModelPrices } from './gemini/pricing.ts';
import { setAiOff } from './config.ts';
export type { FuriganaMode };

export type Settings = {
	newKanjiPerDay: number;
	newVocabPerDay: number;
	furigana: FuriganaMode;
	ttsEnabled: boolean;
	modelPro: string; // vacío = el de por defecto (config.ts)
	modelFlash: string;
	/** Hora local en que empieza el "día" de estudio (como Anki). */
	dayStartHour: number;
	/** El asistente de bienvenida ya se completó (o se saltó). */
	onboardingDone: boolean;
	newGrammarPerDay: number;
	/** Mostrar los enunciados de repaso con fuentes variadas (manga, mincho, a mano…). */
	fontVariety: boolean;
	/** Retención objetivo del SRS (0.80–0.95). */
	desiredRetention: number;
	/** Parámetros FSRS personalizados (21 pesos) o null = por defecto. */
	fsrsParams: number[] | null;
	fsrsCalibratedAt: number | null;
	/** Objetivo con fecha: «leer X para tal día». */
	goal: Goal | null;
	/** Precios de Gemini editados por el alumno (null = los de por defecto de pricing.ts). */
	modelPrices: ModelPrices | null;
	/** Presupuesto mensual en USD para el aviso en Inicio (null = sin presupuesto). */
	monthlyBudgetUsd: number | null;
	/** Al superar el presupuesto, bloquear las llamadas a Gemini (por defecto solo avisa). */
	budgetHardStop: boolean;
	/** Repasos de escritura (trazar kanji): opcional, desactivado por defecto (añade carga). */
	writingReviews: boolean;
	/** Kanji nuevos al día que entran a los repasos de escritura (si están activados). */
	newWritingPerDay: number;
	/**
	 * Uso de la IA (Gemini): `ask` = aún no se eligió (se pregunta si no hay key; con key cuenta como activada),
	 * `on` = activada, `off` = modo sin IA (ni llamadas ni botones de IA; la key se conserva sin usarse).
	 */
	aiMode: AiMode;
	/** Kana nuevos al día en el curso de kana (se enseñan por filas completas). */
	newKanaPerDay: number;
	/** Punto de partida declarado en la bienvenida (null = no lo dijo). */
	startLevel: StartLevel | null;
	/** Pasó por el diagnóstico de kana nuevo: los kana sin tarjeta ya no cuentan como «sabidos de antes» (server/kana.ts). */
	kanaAssessed: boolean;
	/** Exigencia al corregir la escritura a mano (strokes.ts `Strictness`). */
	writingStrictness: 'relaxed' | 'normal' | 'strict';
};

export type AiMode = 'ask' | 'on' | 'off';
export type KanaSelf = 'none' | 'some' | 'slow' | 'fluent';
export type StartLevel = { hiragana: KanaSelf; katakana: KanaSelf; kanji: 'none' | 'some' | 'basic' | 'many' };

export type Goal = {
	label: string;
	/** Kanji aprendidos que hacen falta en total. */
	kanji: number;
	/** Fecha límite (ISO yyyy-mm-dd). */
	date: string;
	/** Texto de la biblioteca del que salió el objetivo (opcional). */
	textId?: number | null;
};

export const DEFAULT_SETTINGS: Settings = {
	newKanjiPerDay: 10,
	newVocabPerDay: 10,
	furigana: 'adaptive',
	ttsEnabled: true,
	modelPro: '',
	modelFlash: '',
	dayStartHour: 4,
	onboardingDone: false,
	newGrammarPerDay: 2,
	fontVariety: true,
	desiredRetention: 0.9,
	fsrsParams: null,
	fsrsCalibratedAt: null,
	goal: null,
	modelPrices: null,
	monthlyBudgetUsd: null,
	budgetHardStop: false,
	writingReviews: false,
	newWritingPerDay: 5,
	aiMode: 'ask',
	newKanaPerDay: 10,
	startLevel: null,
	kanaAssessed: false,
	writingStrictness: 'normal'
};

/** Vuelve a los valores por defecto. Conserva los valores internos (`_…`, p. ej. el secreto de sesión). */
export function resetSettings(db: DB) {
	db.delete(setting).where(sql`substr(${setting.key}, 1, 1) != '_'`).run();
	syncAiMode(db);
	return getSettings(db);
}

/**
 * Aplica el ajuste `aiMode` al interruptor en memoria (`config.aiOff`, que consulta `hasGemini()`).
 * Llamar al abrir la base y cada vez que pueda cambiar (ajustes, importar, sincronizar).
 */
export function syncAiMode(db: DB) {
	setAiOff(getSettings(db).aiMode === 'off');
}

export function getSettings(db: DB): Settings {
	const rows = db.select().from(setting).all();
	const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
	for (const r of rows) {
		if (!(r.key in DEFAULT_SETTINGS)) continue;
		try {
			out[r.key] = JSON.parse(r.value);
		} catch {
			/* valor corrupto: se ignora */
		}
	}
	return out as Settings;
}

export function updateSettings(db: DB, patch: Partial<Settings>) {
	const current = getSettings(db);
	const next = { ...current, ...patch };
	next.ttsEnabled = !!next.ttsEnabled;
	next.onboardingDone = !!next.onboardingDone;
	next.modelPro = String(next.modelPro ?? '').trim();
	next.modelFlash = String(next.modelFlash ?? '').trim();
	next.fontVariety = !!next.fontVariety;
	next.newGrammarPerDay = clampInt(next.newGrammarPerDay, 0, 10);
	const ret = Number(next.desiredRetention);
	next.desiredRetention = Number.isFinite(ret) ? Math.min(0.95, Math.max(0.8, Math.round(ret * 100) / 100)) : 0.9;
	if (!Array.isArray(next.fsrsParams) || next.fsrsParams.length < 17 || !next.fsrsParams.every((x) => Number.isFinite(x)))
		next.fsrsParams = null;
	if (next.goal) {
		const g = next.goal;
		const ok = typeof g.label === 'string' && Number.isFinite(Number(g.kanji)) && /^\d{4}-\d{2}-\d{2}$/.test(String(g.date));
		next.goal = ok
			? { label: g.label.slice(0, 120), kanji: clampInt(g.kanji, 1, 3000), date: String(g.date), textId: g.textId ?? null }
			: null;
	}
	// Lanza con un mensaje legible si la tabla editada no es válida.
	next.modelPrices = next.modelPrices ? normalizePrices(next.modelPrices) : null;
	const budget = next.monthlyBudgetUsd == null || (next.monthlyBudgetUsd as unknown) === '' ? NaN : Number(next.monthlyBudgetUsd);
	next.monthlyBudgetUsd = Number.isFinite(budget) && budget > 0 ? Math.round(budget * 100) / 100 : null;
	next.budgetHardStop = !!next.budgetHardStop;
	next.writingReviews = !!next.writingReviews;
	next.newWritingPerDay = clampInt(next.newWritingPerDay, 1, 30);
	next.newKanjiPerDay = clampInt(next.newKanjiPerDay, 0, 50);
	next.newVocabPerDay = clampInt(next.newVocabPerDay, 0, 50);
	next.dayStartHour = clampInt(next.dayStartHour, 0, 23);
	if (!['adaptive', 'always', 'never'].includes(next.furigana)) next.furigana = 'adaptive';
	if (!['ask', 'on', 'off'].includes(next.aiMode)) next.aiMode = 'ask';
	next.newKanaPerDay = clampInt(next.newKanaPerDay, 0, 40);
	next.kanaAssessed = !!next.kanaAssessed;
	if (!['relaxed', 'normal', 'strict'].includes(next.writingStrictness)) next.writingStrictness = 'normal';
	if (next.startLevel) {
		const l = next.startLevel;
		const kana = (x: unknown): KanaSelf => (['none', 'some', 'slow', 'fluent'].includes(String(x)) ? (x as KanaSelf) : 'none');
		next.startLevel = {
			hiragana: kana(l.hiragana),
			katakana: kana(l.katakana),
			kanji: ['none', 'some', 'basic', 'many'].includes(String(l.kanji)) ? l.kanji : 'none'
		};
	}
	for (const [key, value] of Object.entries(next)) {
		if (!(key in DEFAULT_SETTINGS)) continue;
		db.insert(setting)
			.values({ key, value: JSON.stringify(value) })
			.onConflictDoUpdate({ target: setting.key, set: { value: JSON.stringify(value) } })
			.run();
	}
	setAiOff(next.aiMode === 'off');
	return next;
}

function clampInt(v: unknown, min: number, max: number) {
	const n = Math.round(Number(v));
	return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

/** Valores internos (no expuestos como ajustes), p. ej. el secreto de sesión. */
export function getInternal(db: DB, key: string): string | null {
	return db.select().from(setting).where(eq(setting.key, `_${key}`)).get()?.value ?? null;
}

export function setInternal(db: DB, key: string, value: string) {
	db.insert(setting)
		.values({ key: `_${key}`, value })
		.onConflictDoUpdate({ target: setting.key, set: { value } })
		.run();
}

/** Inicio del día de estudio actual (ms). */
export function dayStart(now: Date, hour: number): number {
	const d = new Date(now);
	d.setHours(hour, 0, 0, 0);
	if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 1);
	return d.getTime();
}
