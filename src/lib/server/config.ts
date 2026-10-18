// Configuración en tiempo de ejecución.
// En el navegador no hay .env: la API key de Gemini la pega el alumno en Ajustes y se guarda en la base
// como valor interno (`_geminiApiKey`, nunca exportado); el Worker la carga al arrancar (loadRuntimeConfig).
// En Bun (tests, scripts) se puede seguir dando por variable de entorno.

import { DEFAULT_MODELS } from '../modelPresets.ts';

const env: Record<string, string | undefined> =
	(globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

export const config = {
	geminiApiKey: env.GEMINI_API_KEY ?? '',
	// Por defecto: el perfil «Equilibrado» (modelPresets.ts).
	modelPro: env.GEMINI_MODEL_PRO || DEFAULT_MODELS.pro,
	modelFlash: env.GEMINI_MODEL_FLASH || DEFAULT_MODELS.flash
};

export function setGeminiApiKey(key: string) {
	config.geminiApiKey = key.trim();
}
