// Perfiles de modelos: estables, con precio, ordenados por costo y el de por defecto = configuración por defecto.
import { expect, test } from 'bun:test';
import { DEFAULT_MODELS, DEFAULT_PRESET, PRESETS, presetOf } from '../src/lib/modelPresets.ts';
import { DEFAULT_PRICES } from '../src/lib/server/gemini/pricing.ts';
import { mixCost } from '../src/lib/server/gemini/usage.ts';
import { config } from '../src/lib/server/config.ts';

test('cada perfil usa modelos estables y con precio', () => {
	for (const p of PRESETS)
		for (const m of [p.pro, p.flash]) {
			expect(m).not.toMatch(/preview|latest|exp/);
			expect(DEFAULT_PRICES[m]).toBeDefined();
		}
});

test('Ahorro < Equilibrado < Máximo, hoy y tras las subidas anunciadas', () => {
	for (const day of ['2026-10-18', '2027-02-01']) {
		const at = new Date(`${day}T12:00:00`).getTime();
		const cost = PRESETS.map((p) => 0.8 * mixCost(DEFAULT_PRICES, p.pro, at)! + 0.2 * mixCost(DEFAULT_PRICES, p.flash, at)!);
		expect(cost[0]).toBeLessThan(cost[1]);
		expect(cost[1]).toBeLessThan(cost[2]);
	}
});

test('por defecto = Equilibrado; presetOf reconoce los perfiles y lo demás es personalizado', () => {
	if (!process.env.GEMINI_MODEL_PRO && !process.env.GEMINI_MODEL_FLASH) {
		expect(config.modelPro).toBe(DEFAULT_MODELS.pro);
		expect(config.modelFlash).toBe(DEFAULT_MODELS.flash);
	}
	expect(presetOf(DEFAULT_MODELS.pro, DEFAULT_MODELS.flash)).toBe(DEFAULT_PRESET);
	for (const p of PRESETS) expect(presetOf(p.pro, p.flash)).toBe(p.id);
	expect(presetOf('gemini-4-argon', 'gemini-3.1-flash-lite')).toBe('custom');
});
