import { GoogleGenAI, type Content, type GenerateContentConfig, type GenerateContentResponse, type Part } from '@google/genai';
import { config } from '../config.ts';
import type { DB } from '../db/index.ts';
import { getSettings } from '../settings.ts';
import { assertBudget, recordUsage, type Feature } from './usage.ts';

export class GeminiUnavailableError extends Error {
	constructor() {
		super(config.aiOff ? 'La IA está desactivada: actívala en Ajustes.' : 'Falta la API key de Gemini: añádela en Ajustes.');
	}
}

let client: { key: string; ai: GoogleGenAI } | null = null;

/** Se puede usar Gemini: hay key y el alumno no eligió el modo sin IA. */
export function hasGemini() {
	return !!config.geminiApiKey && !config.aiOff;
}

export function ai(): GoogleGenAI {
	if (!hasGemini()) throw new GeminiUnavailableError();
	// Se recrea si el alumno cambia la key en Ajustes.
	if (client?.key !== config.geminiApiKey) {
		client = { key: config.geminiApiKey, ai: new GoogleGenAI({ apiKey: config.geminiApiKey }) };
		modelCache = null;
	}
	return client.ai;
}

export function models(db: DB) {
	const st = getSettings(db);
	return { pro: st.modelPro || config.modelPro, flash: st.modelFlash || config.modelFlash };
}

export type JsonSchema = Record<string, unknown>;

/** Toda llamada se registra en gemini_usage (tokens + costo) con su función. */
type Tracked = { db: DB; feature: Feature; sessionId?: number | null };

/** generateContent con reintentos que registra el uso (también si falla). */
async function generateTracked(opts: Tracked & { model: string; contents: string | Content[] | Part[]; config: GenerateContentConfig }) {
	const call = { model: opts.model, feature: opts.feature, sessionId: opts.sessionId };
	assertBudget(opts.db);
	let res: GenerateContentResponse;
	try {
		res = await withRetry(() => ai().models.generateContent({ model: opts.model, contents: opts.contents, config: opts.config }));
	} catch (e) {
		if (!(e instanceof GeminiUnavailableError)) recordUsage(opts.db, { ...call, ok: false });
		throw e;
	}
	recordUsage(opts.db, { ...call, usage: res.usageMetadata });
	return res;
}

/** Genera JSON estructurado validado por el esquema de Gemini (responseJsonSchema). */
export async function generateJson<T>(
	opts: Tracked & {
		model: string;
		system?: string;
		contents: string | Content[] | Part[];
		schema: JsonSchema;
		temperature?: number;
	}
): Promise<T> {
	const res = await generateTracked({
		...opts,
		config: {
			systemInstruction: opts.system,
			responseMimeType: 'application/json',
			responseJsonSchema: opts.schema,
			temperature: opts.temperature
		}
	});
	const text = res.text ?? '';
	try {
		return JSON.parse(text) as T;
	} catch {
		// Algunos modelos envuelven el JSON en ```json … ```
		const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
		if (m) return JSON.parse(m[0]) as T;
		throw new Error(`Respuesta JSON inválida de Gemini: ${text.slice(0, 200)}`);
	}
}

export async function generateText(
	opts: Tracked & { model: string; system?: string; contents: string | Content[]; temperature?: number }
) {
	const res = await generateTracked({ ...opts, config: { systemInstruction: opts.system, temperature: opts.temperature } });
	return res.text ?? '';
}

export type ModelInfo = {
	id: string;
	displayName: string;
	description: string;
	inputLimit: number | null;
	outputLimit: number | null;
	thinking: boolean | null;
	/** Sirve a Sensei: texto con function calling (no voz, imagen, vídeo, embeddings, live, agentes…). */
	compatible: boolean;
};

/** Familias que generan contenido pero no texto de chat con herramientas. */
const INCOMPATIBLE =
	/(tts|image|banana|embedding|live|transcribe|native-audio|audio|robotics|omni|veo|lyria|imagen|antigravity|deep-research|computer-use|aqa|gemma|learnlm)/;

export function isCompatibleModel(id: string) {
	return id.startsWith('gemini-') && !INCOMPATIBLE.test(id);
}

let modelCache: { at: number; list: ModelInfo[] } | null = null;

/** Modelos con generateContent de la API key (cacheados 10 min). */
export async function listModels(): Promise<ModelInfo[]> {
	if (modelCache && Date.now() - modelCache.at < 10 * 60_000) return modelCache.list;
	const out: ModelInfo[] = [];
	const pager = await ai().models.list();
	for await (const m of pager) {
		const id = m.name?.replace(/^models\//, '');
		if (!id || !(m.supportedActions ?? []).includes('generateContent')) continue;
		out.push({
			id,
			displayName: m.displayName ?? id,
			description: m.description ?? '',
			inputLimit: m.inputTokenLimit ?? null,
			outputLimit: m.outputTokenLimit ?? null,
			thinking: (m as { thinking?: boolean }).thinking ?? null,
			compatible: isCompatibleModel(id)
		});
	}
	out.sort((a, b) => a.id.localeCompare(b.id));
	modelCache = { at: Date.now(), list: out };
	return out;
}

export function errorMessage(e: unknown): string {
	if (e instanceof GeminiUnavailableError) return e.message;
	const raw = e instanceof Error ? e.message : String(e);
	const status = errorStatus(e);
	if (status === 503 || status === 500) return 'Gemini no está disponible ahora mismo. Inténtalo de nuevo en unos segundos.';
	if (status === 429) return 'Gemini ha limitado las peticiones (cuota o demasiadas seguidas). Espera un poco y reintenta.';
	if (status === 401 || status === 403)
		return 'Gemini rechazó la API key (revísala en Ajustes; si la restringiste por dominio, incluye esta dirección).';
	if (status === 404) return 'El modelo de Gemini configurado no existe (revisa los modelos en Ajustes).';
	// Mensajes JSON anidados del SDK: extraer el texto legible.
	const inner = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/g)?.pop()?.replace(/^"message"\s*:\s*"/, '').replace(/"$/, '');
	const msg = inner ? inner.replace(/\\+n/g, ' ').replace(/\\+"/g, '"').replace(/\\+/g, '') : raw;
	return msg.length > 300 ? msg.slice(0, 300) + '…' : msg;
}

/** Código HTTP de un error del SDK de Gemini, si se puede deducir. */
export function errorStatus(e: unknown): number | null {
	const any = e as { status?: number; code?: number } | null;
	if (typeof any?.status === 'number') return any.status;
	if (typeof any?.code === 'number') return any.code;
	const raw = e instanceof Error ? e.message : String(e);
	const m = raw.match(/"code"\s*:\s*(\d{3})/) ?? raw.match(/\b(429|500|503)\b/);
	return m ? Number(m[1]) : null;
}

/** Errores pasajeros: vale la pena reintentar. */
export function isTransient(e: unknown) {
	const s = errorStatus(e);
	return s === 429 || s === 500 || s === 503 || s === 502 || s === 504;
}

/** Reintenta `fn` ante errores pasajeros (1 s, 3 s). */
export async function withRetry<T>(fn: () => Promise<T>, delays = [1000, 3000]): Promise<T> {
	for (let i = 0; ; i++) {
		try {
			return await fn();
		} catch (e) {
			if (i >= delays.length || !isTransient(e)) throw e;
			await new Promise((r) => setTimeout(r, delays[i]));
		}
	}
}
