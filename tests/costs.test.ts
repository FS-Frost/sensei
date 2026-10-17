import { describe, expect, test } from 'bun:test';
import { openDb } from '../src/lib/server/db/bun.ts';
import * as s from '../src/lib/server/db/schema.ts';
import { costOf, DEFAULT_PRICES, effectivePrices, normalizePrices, priceKey, priceSummary } from '../src/lib/server/gemini/pricing.ts';
import {
	budgetStatus,
	costReport,
	mixCost,
	projectCost,
	recomputeCosts,
	recordUsage,
	roleUsage,
	sessionCosts,
	trackCost
} from '../src/lib/server/gemini/usage.ts';
import { isCompatibleModel } from '../src/lib/server/gemini/client.ts';
import { updateSettings } from '../src/lib/server/settings.ts';
import { applySnapshot, buildSnapshot } from '../src/lib/server/data/snapshot.ts';
import { applyReset, previewReset } from '../src/lib/server/data/reset.ts';
import { fmtPrice, fmtUsd } from '../src/lib/cost.ts';

const at = (iso: string) => new Date(`${iso}T12:00:00`).getTime();
const usage = (prompt: number, output: number, extra: Record<string, number> = {}) => ({
	promptTokenCount: prompt,
	candidatesTokenCount: output,
	...extra
});

describe('precios', () => {
	test('tramo vigente por fecha, caché, razonamiento y prefijo', () => {
		const t = { prompt: 1_000_000, cached: 200_000, output: 100_000, thoughts: 100_000, toolPrompt: 0 };
		// Argon antes del 1-dic-2026: 800k × $2 + 200k × $0.10 + 200k × $10 = 1.6 + 0.02 + 2 = 3.62
		expect(costOf(DEFAULT_PRICES, 'gemini-4-argon', t, at('2026-11-30'))).toBeCloseTo(3.62, 6);
		// Desde el 1-dic-2026 el precio se duplica.
		expect(costOf(DEFAULT_PRICES, 'gemini-4-argon', t, at('2026-12-01'))).toBeCloseTo(7.24, 6);
		expect(priceKey(DEFAULT_PRICES, 'gemini-4-argon-preview-09')).toBe('gemini-4-argon');
		expect(costOf(DEFAULT_PRICES, 'otro-modelo', t, at('2026-10-01'))).toBeNull();
	});

	test('prefijo solo con sufijo de versión, prompt largo y próxima subida', () => {
		expect(priceKey(DEFAULT_PRICES, 'gemini-3.8-flash-tts')).toBeNull(); // la voz no hereda el precio de texto
		expect(priceKey(DEFAULT_PRICES, 'gemini-3.8-flash-lite-tts')).toBeNull();
		expect(priceKey(DEFAULT_PRICES, 'gemini-3.1-pro-preview-customtools')).toBe('gemini-3.1-pro-preview');
		expect(priceKey(DEFAULT_PRICES, 'gemini-2.5-flash-lite')).toBe('gemini-2.5-flash-lite'); // exacto gana al prefijo
		const big = { prompt: 300_000, cached: 0, output: 1_000, thoughts: 0, toolPrompt: 0 };
		// >200k: 300k × $2.50 + 1k × $15 = 0.75 + 0.015
		expect(costOf(DEFAULT_PRICES, 'gemini-2.5-pro', big, at('2026-10-17'))).toBeCloseTo(0.765, 9);
		const sum = priceSummary(DEFAULT_PRICES, 'gemini-4-argon', at('2026-10-17'))!;
		expect(sum.now!.input).toBe(2);
		expect(sum.next).toMatchObject({ from: '2026-12-01', input: 4 });
		expect(priceSummary(DEFAULT_PRICES, 'gemini-2.5-flash', at('2026-10-17'))!.next).toBeNull();
		// El tramo largo sobrevive a la edición.
		expect(normalizePrices({ m: DEFAULT_PRICES['gemini-2.5-pro'] }).m[0].long).toEqual({ input: 2.5, cached: 0.25, output: 15 });
	});

	test('modelos compatibles con Sensei', () => {
		for (const id of ['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-2.5-flash-lite'])
			expect(isCompatibleModel(id)).toBe(true);
		for (const id of ['gemini-3.8-flash-tts', 'gemini-3-pro-image', 'gemini-embedding-2', 'gemini-3.8-live', 'antigravity-preview-latest', 'deep-research-max-preview-04-2026', 'gemma-4-27b-it', 'veo-3.1-generate-preview'])
			expect(isCompatibleModel(id)).toBe(false);
	});

	test('validación de la tabla editada', () => {
		expect(() => normalizePrices({ x: [{ from: 'ayer', input: 1, cached: 0, output: 1 }] })).toThrow('fecha');
		expect(() => normalizePrices({ x: [{ from: '2026-01-01', input: -1, cached: 0, output: 1 }] })).toThrow('precio de entrada');
		const p = normalizePrices({ ' m ': [{ from: '2027-01-01', input: 2, cached: 0, output: 4 }, { from: '2000-01-01', input: 1, cached: 0, output: 2 }] });
		expect(Object.keys(p)).toEqual(['m']);
		expect(p.m.map((x) => x.from)).toEqual(['2000-01-01', '2027-01-01']); // ordenados
		// Los del alumno sustituyen modelo a modelo.
		expect(effectivePrices(p)['gemini-4-argon']).toEqual(DEFAULT_PRICES['gemini-4-argon']);
	});

	test('formato con decimales según magnitud', () => {
		expect(fmtUsd(0)).toBe('$0');
		expect(fmtUsd(0.00421)).toBe('$0.0042');
		expect(fmtUsd(0.25)).toBe('$0.250');
		expect(fmtUsd(12.345)).toBe('$12.35');
		expect(fmtUsd(null)).toBe('—');
		expect(fmtPrice(2)).toBe('$2.00');
		expect(fmtPrice(0.1)).toBe('$0.10');
		expect(fmtPrice(0.075)).toBe('$0.075');
		expect(fmtPrice(3.75)).toBe('$3.75');
	});
});

describe('registro y agregados', () => {
	const db = openDb(':memory:').db;
	const now = new Date(at('2026-10-17'));
	const sess = db.insert(s.session).values({ mode: 'libre', title: 'Sesión cara', startedAt: now.getTime(), lastAt: now.getTime() }).returning().get();

	test('cada llamada guarda tokens y costo; trackCost suma las de una operación', async () => {
		const { result, cost } = await trackCost(async () => {
			recordUsage(db, { model: 'gemini-4-argon', feature: 'reading', usage: usage(10_000, 2_000), at: now.getTime() });
			recordUsage(db, { model: 'gemini-3.8-flash', feature: 'glosses', usage: usage(4_000, 400), at: now.getTime() });
			recordUsage(db, { model: 'gemini-4-argon', feature: 'reading', ok: false, at: now.getTime() }); // fallida: $0
			return 'ok';
		});
		expect(result).toBe('ok');
		// 10k×2 + 2k×10 = 0.04 ; 4k×0.75 + 400×3.75 = 0.0045
		expect(cost!.usd).toBeCloseTo(0.0445, 9);
		expect(cost!.calls).toBe(2);
		expect(cost!.unpriced).toBe(false);
		// Sin llamadas dentro: null (p. ej. todo estaba en caché).
		expect((await trackCost(async () => 1)).cost).toBeNull();
	});

	test('tutor por sesión, modelo sin precio, informe por función y modelo', () => {
		recordUsage(db, { model: 'gemini-4-argon', feature: 'tutor', sessionId: sess.id, usage: usage(50_000, 1_000, { cachedContentTokenCount: 40_000 }), at: now.getTime() });
		recordUsage(db, { model: 'modelo-raro', feature: 'tutor', sessionId: sess.id, usage: usage(100, 10), at: now.getTime() });
		recordUsage(db, { model: 'gemini-3.8-flash', feature: 'summary', usage: usage(1_000, 100), at: at('2026-09-20') });

		const rep = costReport(db, 30, now);
		expect(rep.totals.calls).toBe(6);
		expect(rep.totals.failed).toBe(1);
		expect(rep.totals.unpriced).toBe(1);
		expect(rep.daily).toHaveLength(30);
		expect(rep.daily.at(-1)!.calls).toBe(5);
		const tutor = rep.byFeature.find((f) => f.key === 'tutor')!;
		expect(tutor.label).toBe('Tutor (chat)');
		expect(tutor.parts.map((p) => p.key).sort()).toEqual(['gemini-4-argon', 'modelo-raro']);
		// 10k×2 + 40k×0.1 + 1k×10 = 0.02 + 0.004 + 0.01 = 0.034
		expect(tutor.usd).toBeCloseTo(0.034, 9);
		const argon = rep.byModel.find((m) => m.key === 'gemini-4-argon')!;
		expect(argon.parts.map((p) => p.label)).toContain('Lectura graduada');
		expect(rep.topSessions[0]).toMatchObject({ id: sess.id, title: 'Sesión cara', calls: 2 });
		expect(sessionCosts(db, [sess.id]).get(sess.id)).toBeCloseTo(0.034, 9);
		// Mes en curso vs anterior.
		expect(rep.month.calls).toBe(5);
		expect(rep.prevMonth.calls).toBe(1);
	});

	test('estimación para elegir modelo: uso real del rol repreciado', () => {
		const pro = roleUsage(db, 'pro', 30, now.getTime());
		// reading + tutor×2 (la fallida no cuenta; glosses y summary son Flash)
		expect(pro).toHaveLength(3);
		expect(roleUsage(db, 'flash', 30, now.getTime())).toHaveLength(2); // glosses + summary (20-sep, dentro de 30 días)
		expect(roleUsage(db, 'flash', 7, now.getTime())).toHaveLength(1);
		const prices = effectivePrices(null);
		// modelo-raro no tiene precio → la estimación con Argon no se puede hacer… salvo con modelos con precio:
		const argon = projectCost(prices, 'gemini-4-argon', pro, now.getTime())!;
		const lite = projectCost(prices, 'gemini-2.5-flash-lite', pro, now.getTime())!;
		expect(argon).toBeGreaterThan(lite * 10);
		expect(projectCost(prices, 'sin-precio', pro, now.getTime())).toBeNull();
		expect(mixCost(prices, 'gemini-4-argon', now.getTime())).toBeCloseTo(0.9 * 2 + 0.1 * 10, 9);
	});

	test('presupuesto: aviso al 80 % y superado', () => {
		expect(budgetStatus(db, now).level).toBe('none');
		updateSettings(db, { monthlyBudgetUsd: 0.09 });
		expect(budgetStatus(db, now).level).toBe('warn'); // 0.0785 / 0.09 ≈ 87 %
		updateSettings(db, { monthlyBudgetUsd: 0.05 });
		expect(budgetStatus(db, now).level).toBe('over');
		updateSettings(db, { monthlyBudgetUsd: 1 });
		expect(budgetStatus(db, now).level).toBe('ok');
		expect(budgetStatus(db, now).projected).toBeGreaterThan(budgetStatus(db, now).spent);
	});

	test('recalcular con precios nuevos (y el modelo que no tenía precio)', () => {
		updateSettings(db, { modelPrices: { 'modelo-raro': [{ from: '2000-01-01', input: 1000, cached: 0, output: 0 }] } });
		recomputeCosts(db);
		const raro = db.select().from(s.geminiUsage).all().find((r) => r.model === 'modelo-raro')!;
		expect(raro.costUsd).toBeCloseTo(0.1, 9); // 100 tokens × $1000/M
		const failed = db.select().from(s.geminiUsage).all().find((r) => !r.ok)!;
		expect(failed.costUsd).toBe(0);
	});

	test('viaja en el .zip y se reinicia desde Datos', () => {
		const snap = buildSnapshot(db);
		expect(snap.generated.usage).toHaveLength(6);
		const other = openDb(':memory:').db;
		applySnapshot(other, snap);
		expect(other.select().from(s.geminiUsage).all()).toHaveLength(6);
		// Copias antiguas sin registro: se importan igual.
		applySnapshot(other, { ...snap, generated: { texts: [] } });
		expect(other.select().from(s.geminiUsage).all()).toHaveLength(0);

		expect(previewReset(db, { usage: true }).usage).toBe(6);
		applyReset(db, { tutor: true });
		expect(db.select().from(s.geminiUsage).all()).toHaveLength(6); // borrar el tutor no borra el gasto
		applyReset(db, { usage: true });
		expect(db.select().from(s.geminiUsage).all()).toHaveLength(0);
	});
});
