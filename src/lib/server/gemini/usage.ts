// Registro del uso de Gemini (tokens y costo por llamada) y agregados para /costos.
import { AsyncLocalStorage } from 'node:async_hooks';
import { desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { GenerateContentResponseUsageMetadata } from '@google/genai';
import type { DB } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { getSettings } from '../settings.ts';
import { costOf, effectivePrices, priceKey, tierAt, type Tokens } from './pricing.ts';
import type { OperationCost } from '../../cost.ts';

/** Para qué se llama a Gemini. Las claves se guardan en `gemini_usage.feature`: no renombrarlas. */
export const FEATURES = {
	tutor: 'Tutor (chat)',
	summary: 'Resumen de sesión',
	reading: 'Lectura graduada',
	explain: 'Explicador',
	report: 'Informe semanal',
	why: '«¿Por qué?» en repaso',
	mnemonic: 'Mnemotecnias',
	leech_mnemonic: 'Mnemotecnia nueva (tarjeta difícil)',
	component_names: 'Nombres de componentes',
	similar_tips: 'Kanji parecidos',
	glosses: 'Traducción de palabras',
	sentences: 'Traducción de frases'
} as const;

export type Feature = keyof typeof FEATURES;

/** Qué modelo usa cada función: `models(db).pro` o `.flash` (debe coincidir con los llamadores). */
export const FEATURE_ROLE: Record<Feature, 'pro' | 'flash'> = {
	tutor: 'pro',
	reading: 'pro',
	explain: 'pro',
	mnemonic: 'pro',
	leech_mnemonic: 'pro',
	summary: 'flash',
	report: 'flash',
	why: 'flash',
	component_names: 'flash',
	similar_tips: 'flash',
	glosses: 'flash',
	sentences: 'flash'
};

export function featureLabel(f: string) {
	return (FEATURES as Record<string, string>)[f] ?? f;
}

export function tokensFrom(u: GenerateContentResponseUsageMetadata | undefined): Tokens & { image: number } {
	return {
		prompt: u?.promptTokenCount ?? 0,
		cached: u?.cachedContentTokenCount ?? 0,
		output: u?.candidatesTokenCount ?? 0,
		thoughts: u?.thoughtsTokenCount ?? 0,
		toolPrompt: u?.toolUsePromptTokenCount ?? 0,
		image: (u?.promptTokensDetails ?? []).filter((d) => d.modality === 'IMAGE').reduce((a, d) => a + (d.tokenCount ?? 0), 0)
	};
}

// ---------- Costo de una operación (p. ej. «esta lectura costó ≈ $0.004») ----------

type Tally = { usd: number; calls: number; unpriced: number };
const tally = new AsyncLocalStorage<Tally>();

/** Ejecuta `fn` sumando el costo de todas las llamadas a Gemini que haga (incluidas las anidadas). */
export async function trackCost<T>(fn: () => Promise<T>): Promise<{ result: T; cost: OperationCost | null }> {
	const t: Tally = { usd: 0, calls: 0, unpriced: 0 };
	const result = await tally.run(t, fn);
	return { result, cost: t.calls ? { usd: t.usd, calls: t.calls, unpriced: t.unpriced > 0 } : null };
}

// ---------- Registro ----------

export function recordUsage(
	db: DB,
	call: { model: string; feature: Feature; sessionId?: number | null; usage?: GenerateContentResponseUsageMetadata; ok?: boolean; at?: number }
) {
	const at = call.at ?? Date.now();
	const ok = call.ok ?? true;
	const t = tokensFrom(call.usage);
	// Las llamadas fallidas no se facturan.
	const cost = ok ? costOf(effectivePrices(getSettings(db).modelPrices), call.model, t, at) : 0;
	db.insert(s.geminiUsage)
		.values({
			at,
			model: call.model,
			feature: call.feature,
			sessionId: call.sessionId ?? null,
			promptTokens: t.prompt,
			cachedTokens: t.cached,
			outputTokens: t.output,
			thoughtsTokens: t.thoughts,
			toolPromptTokens: t.toolPrompt,
			imageTokens: t.image,
			costUsd: cost,
			ok
		})
		.run();
	const cur = tally.getStore();
	if (cur && ok) {
		cur.calls++;
		if (cost == null) cur.unpriced++;
		else cur.usd += cost;
	}
	return cost;
}

/** Recalcula el costo de todo el historial con los precios actuales (p. ej. tras corregir un precio). */
export function recomputeCosts(db: DB) {
	const prices = effectivePrices(getSettings(db).modelPrices);
	const rows = db.select().from(s.geminiUsage).all();
	db.transaction((tx) => {
		for (const r of rows) {
			const cost = r.ok
				? costOf(
						prices,
						r.model,
						{ prompt: r.promptTokens, cached: r.cachedTokens, output: r.outputTokens, thoughts: r.thoughtsTokens, toolPrompt: r.toolPromptTokens },
						r.at
					)
				: 0;
			if (cost !== r.costUsd) tx.update(s.geminiUsage).set({ costUsd: cost }).where(eq(s.geminiUsage.id, r.id)).run();
		}
	});
	return rows.length;
}

// ---------- Agregados ----------

const DAY = 86_400_000;

function dayKey(at: number) {
	const d = new Date(at);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfDay(at: number) {
	const d = new Date(at);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

export function monthBounds(now: Date) {
	const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
	const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
	const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
	return { start, end, prevStart };
}

function sumSince(db: DB, from: number, to = Number.MAX_SAFE_INTEGER) {
	const r = db
		.select({ usd: sql<number>`coalesce(sum(${s.geminiUsage.costUsd}), 0)`, calls: sql<number>`count(*)` })
		.from(s.geminiUsage)
		.where(sql`${s.geminiUsage.at} >= ${from} and ${s.geminiUsage.at} < ${to}`)
		.get();
	return { usd: r?.usd ?? 0, calls: r?.calls ?? 0 };
}

export type BudgetStatus = {
	budget: number | null;
	spent: number;
	projected: number;
	ratio: number | null;
	level: 'none' | 'ok' | 'warn' | 'over';
};

/** Gasto del mes en curso, proyección lineal a fin de mes y estado frente al presupuesto. */
export function budgetStatus(db: DB, now = new Date()): BudgetStatus {
	const { start, end } = monthBounds(now);
	const spent = sumSince(db, start, end).usd;
	const elapsed = Math.max(1, (now.getTime() - start) / DAY);
	const projected = (spent / elapsed) * ((end - start) / DAY);
	const budget = getSettings(db).monthlyBudgetUsd;
	const ratio = budget ? spent / budget : null;
	const level = ratio == null ? 'none' : ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok';
	return { budget, spent, projected, ratio, level };
}

export class BudgetExceededError extends Error {
	constructor(budget: number) {
		super(`Superaste el presupuesto mensual de Gemini ($${budget.toFixed(2)}). Súbelo o desactiva el bloqueo en Costos.`);
	}
}

/** Con «bloquear al superar» activo, impide nuevas llamadas una vez gastado el presupuesto del mes. */
export function assertBudget(db: DB, now = new Date()) {
	const st = getSettings(db);
	if (!st.budgetHardStop || !st.monthlyBudgetUsd) return;
	if (budgetStatus(db, now).level === 'over') throw new BudgetExceededError(st.monthlyBudgetUsd);
}

export type CostRange = 7 | 30 | 90 | 0; // 0 = todo

export function costReport(db: DB, range: CostRange, now = new Date()) {
	const { start, prevStart } = monthBounds(now);
	const from = range ? startOfDay(now.getTime() - (range - 1) * DAY) : 0;
	const inRange = sql`${s.geminiUsage.at} >= ${from}`;
	const u = s.geminiUsage;

	const totals = db
		.select({
			usd: sql<number>`coalesce(sum(${u.costUsd}), 0)`,
			calls: sql<number>`count(*)`,
			failed: sql<number>`coalesce(sum(case when ${u.ok} then 0 else 1 end), 0)`,
			unpriced: sql<number>`coalesce(sum(case when ${u.costUsd} is null then 1 else 0 end), 0)`,
			prompt: sql<number>`coalesce(sum(${u.promptTokens} - ${u.cachedTokens}), 0)`,
			cached: sql<number>`coalesce(sum(${u.cachedTokens}), 0)`,
			output: sql<number>`coalesce(sum(${u.outputTokens}), 0)`,
			thoughts: sql<number>`coalesce(sum(${u.thoughtsTokens}), 0)`,
			tool: sql<number>`coalesce(sum(${u.toolPromptTokens}), 0)`,
			image: sql<number>`coalesce(sum(${u.imageTokens}), 0)`
		})
		.from(u)
		.where(inRange)
		.get()!;

	// Serie diaria (días sin llamadas = 0). Con «todo», desde la primera llamada.
	const first = range ? from : (db.select({ at: sql<number>`min(${u.at})` }).from(u).get()?.at ?? now.getTime());
	const rows = db.select({ at: u.at, usd: u.costUsd }).from(u).where(gte(u.at, startOfDay(first))).all();
	const byDay = new Map<string, { usd: number; calls: number }>();
	for (let t = startOfDay(first); t <= now.getTime(); t += DAY) byDay.set(dayKey(t), { usd: 0, calls: 0 });
	for (const r of rows) {
		const d = byDay.get(dayKey(r.at));
		if (!d) continue;
		d.usd += r.usd ?? 0;
		d.calls++;
	}
	const daily = [...byDay].map(([day, v]) => ({ day, ...v }));

	// Desglose por función y modelo: «qué modelo se usa cuándo».
	const pairs = db
		.select({
			feature: u.feature,
			model: u.model,
			usd: sql<number>`coalesce(sum(${u.costUsd}), 0)`,
			calls: sql<number>`count(*)`,
			prompt: sql<number>`coalesce(sum(${u.promptTokens}), 0)`,
			cached: sql<number>`coalesce(sum(${u.cachedTokens}), 0)`,
			output: sql<number>`coalesce(sum(${u.outputTokens} + ${u.thoughtsTokens}), 0)`,
			last: sql<number>`max(${u.at})`
		})
		.from(u)
		.where(inRange)
		.groupBy(u.feature, u.model)
		.all();
	// Ahorro de la caché: lo que habría costado la entrada cacheada a precio normal, menos lo pagado (precios de hoy).
	const prices = effectivePrices(getSettings(db).modelPrices);
	const savedBy = (model: string, cached: number) => {
		const key = priceKey(prices, model);
		const t = key ? tierAt(prices[key], now.getTime()) : null;
		return t ? (cached * (t.input - t.cached)) / 1e6 : 0;
	};
	type Group = {
		key: string;
		usd: number;
		calls: number;
		prompt: number;
		cached: number;
		saved: number;
		output: number;
		parts: { key: string; usd: number; calls: number }[];
	};
	const group = <K extends 'feature' | 'model'>(key: K, other: 'feature' | 'model') => {
		const m = new Map<string, Group>();
		for (const p of pairs) {
			const g = m.get(p[key]) ?? { key: p[key], usd: 0, calls: 0, prompt: 0, cached: 0, saved: 0, output: 0, parts: [] };
			g.usd += p.usd;
			g.calls += p.calls;
			g.prompt += p.prompt;
			g.cached += p.cached;
			g.saved += savedBy(p.model, p.cached);
			g.output += p.output;
			g.parts.push({ key: p[other], usd: p.usd, calls: p.calls });
			m.set(p[key], g);
		}
		return [...m.values()]
			.map((g) => ({ ...g, cacheRatio: g.prompt ? g.cached / g.prompt : 0, parts: g.parts.sort((a, b) => b.usd - a.usd || b.calls - a.calls) }))
			.sort((a, b) => b.usd - a.usd || b.calls - a.calls);
	};
	const byFeature = group('feature', 'model').map((g) => ({
		...g,
		label: featureLabel(g.key),
		parts: g.parts.map((p) => ({ ...p, label: p.key }))
	}));
	const byModel = group('model', 'feature').map((g) => ({
		...g,
		label: g.key,
		parts: g.parts.map((p) => ({ ...p, label: featureLabel(p.key) }))
	}));

	const topSessions = db
		.select({
			id: u.sessionId,
			title: s.session.title,
			mode: s.session.mode,
			usd: sql<number>`coalesce(sum(${u.costUsd}), 0)`,
			calls: sql<number>`count(*)`,
			last: sql<number>`max(${u.at})`
		})
		.from(u)
		.leftJoin(s.session, eq(s.session.id, u.sessionId))
		.where(sql`${inRange} and ${u.sessionId} is not null`)
		.groupBy(u.sessionId)
		.orderBy(sql`3 desc`)
		.limit(10)
		.all()
		.map((r) => ({ ...r, deleted: r.title == null && r.mode == null }));

	const recent = db
		.select()
		.from(u)
		.orderBy(desc(u.at), desc(u.id))
		.limit(50)
		.all()
		.map((r) => ({ ...r, label: featureLabel(r.feature) }));

	const month = sumSince(db, start);
	const prevMonth = sumSince(db, prevStart, start);
	return {
		range,
		totals,
		month,
		prevMonth,
		budget: budgetStatus(db, now),
		daily,
		byFeature,
		byModel,
		topSessions,
		recent,
		allTime: sumSince(db, 0)
	};
}

export type CostReport = ReturnType<typeof costReport>;

// ---------- Estimación para elegir modelo ----------

/** Mezcla típica si aún no hay uso: el tutor reenvía mucho historial y escribe poco. */
const DEFAULT_MIX: Tokens = { prompt: 900_000, cached: 0, output: 100_000, thoughts: 0, toolPrompt: 0 };

/**
 * Tokens que gastaron las funciones de un rol en los últimos `days` días, llamada a llamada
 * (hace falta por llamada para aplicar bien el tramo de prompt largo).
 */
export function roleUsage(db: DB, role: 'pro' | 'flash', days = 30, now = Date.now()) {
	const features = (Object.keys(FEATURE_ROLE) as Feature[]).filter((f) => FEATURE_ROLE[f] === role);
	return db
		.select({
			prompt: s.geminiUsage.promptTokens,
			cached: s.geminiUsage.cachedTokens,
			output: s.geminiUsage.outputTokens,
			thoughts: s.geminiUsage.thoughtsTokens,
			toolPrompt: s.geminiUsage.toolPromptTokens
		})
		.from(s.geminiUsage)
		.where(sql`${s.geminiUsage.ok} and ${s.geminiUsage.at} >= ${now - days * DAY} and ${inArray(s.geminiUsage.feature, features)}`)
		.all();
}

/**
 * Cuánto habría costado el uso real de un rol (últimos `days` días) con `model`, a precios de hoy.
 * Supone los mismos tokens: otro modelo puede razonar más o menos. null = sin precio.
 */
export function projectCost(prices: ReturnType<typeof effectivePrices>, model: string, calls: Tokens[], now = Date.now()) {
	let usd = 0;
	for (const t of calls) {
		const c = costOf(prices, model, t, now);
		if (c == null) return null;
		usd += c;
	}
	return usd;
}

/** Costo de la mezcla típica (para comparar modelos sin uso registrado). */
export function mixCost(prices: ReturnType<typeof effectivePrices>, model: string, now = Date.now()) {
	return costOf(prices, model, DEFAULT_MIX, now);
}

/** Costo acumulado por sesión del tutor. */
export function sessionCosts(db: DB, ids?: number[]): Map<number, number> {
	const u = s.geminiUsage;
	const rows = db
		.select({ id: u.sessionId, usd: sql<number>`coalesce(sum(${u.costUsd}), 0)` })
		.from(u)
		.where(ids ? inArray(u.sessionId, ids.length ? ids : [-1]) : sql`${u.sessionId} is not null`)
		.groupBy(u.sessionId)
		.all();
	return new Map(rows.map((r) => [r.id!, r.usd]));
}
