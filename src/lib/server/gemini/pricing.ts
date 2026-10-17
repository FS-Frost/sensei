// Precios de Gemini (USD por 1M de tokens) con tramos por fecha: un modelo puede cambiar de precio en un día fijo.
// Los valores por defecto salen de https://ai.google.dev/gemini-api/docs/pricing (nivel de pago, estándar);
// el alumno puede editarlos en /costos (ajuste `modelPrices`).

export type PriceTier = {
	/** Vigente desde este día (ISO yyyy-mm-dd, hora local). El primer tramo suele ser '2000-01-01'. */
	from: string;
	/** Entrada (prompt) no cacheada. */
	input: number;
	/** Entrada servida desde caché (implícita o explícita). */
	cached: number;
	/** Salida, incluidos los tokens de razonamiento. */
	output: number;
	/** Precios si el prompt supera LONG_PROMPT tokens (solo algunos modelos Pro). */
	long?: { input: number; cached: number; output: number };
};

export type ModelPrices = Record<string, PriceTier[]>;

/** Umbral de «prompt largo» de la tarifa de Google. */
export const LONG_PROMPT = 200_000;

const ALWAYS = '2000-01-01';

// Revisado el 2026-10-17. Solo modelos de texto (los de voz, imagen, vídeo o embeddings no los usa Sensei).
export const DEFAULT_PRICES: ModelPrices = {
	'gemini-4-argon': [
		{ from: ALWAYS, input: 2, cached: 0.1, output: 10 },
		{ from: '2026-12-01', input: 4, cached: 0.2, output: 20 }
	],
	'gemini-3.8-flash': [
		{ from: ALWAYS, input: 0.75, cached: 0.075, output: 3.75 },
		{ from: '2027-01-01', input: 1.5, cached: 0.15, output: 7.5 }
	],
	'gemini-3.6-flash': [
		{ from: ALWAYS, input: 0.75, cached: 0.075, output: 3.75 },
		{ from: '2027-01-01', input: 1.5, cached: 0.15, output: 7.5 }
	],
	'gemini-3.5-flash-lite': [{ from: ALWAYS, input: 0.3, cached: 0.03, output: 2.5 }],
	'gemini-3.1-flash-lite': [{ from: ALWAYS, input: 0.25, cached: 0.025, output: 1.5 }],
	'gemini-3.1-pro-preview': [
		{ from: ALWAYS, input: 2, cached: 0.2, output: 12, long: { input: 4, cached: 0.4, output: 18 } }
	],
	'gemini-3-flash-preview': [{ from: ALWAYS, input: 0.5, cached: 0.05, output: 3 }],
	'gemini-2.5-pro': [{ from: ALWAYS, input: 1.25, cached: 0.125, output: 10, long: { input: 2.5, cached: 0.25, output: 15 } }],
	'gemini-2.5-flash': [{ from: ALWAYS, input: 0.3, cached: 0.03, output: 2.5 }],
	'gemini-2.5-flash-lite': [{ from: ALWAYS, input: 0.1, cached: 0.01, output: 0.4 }]
};

/** Tokens de una llamada (de `usageMetadata`). `prompt` incluye `cached`. */
export type Tokens = {
	prompt: number;
	cached: number;
	output: number;
	thoughts: number;
	toolPrompt: number;
};

/** Precios efectivos: los del alumno sustituyen modelo a modelo a los de por defecto. */
export function effectivePrices(custom: ModelPrices | null | undefined): ModelPrices {
	return { ...DEFAULT_PRICES, ...(custom ?? {}) };
}

/**
 * Clave de precios que corresponde a un modelo: exacta, o el prefijo más largo seguido de un sufijo de versión
 * («-preview», «-latest», «-exp», «-001», «-09-2026», «-customtools»). Así «gemini-3.8-flash-tts» NO hereda el precio
 * de «gemini-3.8-flash».
 */
const VERSION_SUFFIX = /^-(preview|latest|exp|customtools|\d)/;
export function priceKey(prices: ModelPrices, model: string): string | null {
	if (prices[model]) return model;
	let best: string | null = null;
	for (const k of Object.keys(prices))
		if (model.startsWith(k) && VERSION_SUFFIX.test(model.slice(k.length)) && (!best || k.length > best.length)) best = k;
	return best;
}

function isoDay(at: number) {
	const d = new Date(at);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Tramo vigente en `at` (el último cuyo `from` ya llegó). */
export function tierAt(tiers: PriceTier[], at: number): PriceTier | null {
	const day = isoDay(at);
	let cur: PriceTier | null = null;
	for (const t of [...tiers].sort((a, b) => a.from.localeCompare(b.from))) if (t.from <= day) cur = t;
	return cur;
}

/** Costo en USD, o null si el modelo no tiene precio. */
export function costOf(prices: ModelPrices, model: string, tokens: Tokens, at: number): number | null {
	const key = priceKey(prices, model);
	const tier = key ? tierAt(prices[key], at) : null;
	if (!tier) return null;
	const p = tier.long && tokens.prompt > LONG_PROMPT ? tier.long : tier;
	const fresh = Math.max(0, tokens.prompt - tokens.cached) + tokens.toolPrompt;
	return (fresh * p.input + tokens.cached * p.cached + (tokens.output + tokens.thoughts) * p.output) / 1e6;
}

/** Precio vigente hoy y la próxima subida/bajada programada, para mostrar. */
export function priceSummary(prices: ModelPrices, model: string, at = Date.now()) {
	const key = priceKey(prices, model);
	if (!key) return null;
	const tiers = [...prices[key]].sort((a, b) => a.from.localeCompare(b.from));
	const now = tierAt(tiers, at);
	const day = isoDay(at);
	const next = tiers.find((t) => t.from > day) ?? null;
	return { key, now, next };
}

const FIELD_ES = { input: 'entrada', cached: 'caché', output: 'salida' } as const;

/** Valida y normaliza una tabla de precios editada a mano. Lanza con un mensaje en español si algo no cuadra. */
export function normalizePrices(raw: unknown): ModelPrices {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Tabla de precios inválida');
	const out: ModelPrices = {};
	for (const [model, tiers] of Object.entries(raw as Record<string, unknown>)) {
		const name = model.trim();
		if (!name) continue;
		if (!Array.isArray(tiers) || !tiers.length) throw new Error(`«${name}»: falta al menos un tramo`);
		out[name] = tiers
			.map((t) => {
				const x = t as Record<string, unknown>;
				const from = String(x.from ?? '');
				if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error(`«${name}»: fecha «${from}» inválida (aaaa-mm-dd)`);
				const num = (k: 'input' | 'cached' | 'output') => {
					const n = Number(x[k]);
					if (!Number.isFinite(n) || n < 0) throw new Error(`«${name}» ${from}: precio de ${FIELD_ES[k]} inválido`);
					return n;
				};
				const tier: PriceTier = { from, input: num('input'), cached: num('cached'), output: num('output') };
				// El tramo de prompt largo no se edita en la UI, pero se conserva.
				const l = x.long as Record<string, unknown> | undefined;
				if (l && typeof l === 'object') {
					const n = (k: string) => Math.max(0, Number(l[k]) || 0);
					tier.long = { input: n('input'), cached: n('cached'), output: n('output') };
				}
				return tier;
			})
			.sort((a, b) => a.from.localeCompare(b.from));
	}
	return out;
}
