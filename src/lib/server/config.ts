// Configuración en tiempo de ejecución.
// En el navegador no hay .env: la API key de Gemini la pega el alumno en Ajustes y se guarda en la base
// como valor interno (`_geminiApiKey`, nunca exportado); el Worker la carga al arrancar (loadRuntimeConfig).
// En Bun (tests, scripts) se puede seguir dando por variable de entorno.

const env: Record<string, string | undefined> =
	(globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

export const config = {
	geminiApiKey: env.GEMINI_API_KEY ?? '',
	modelPro: env.GEMINI_MODEL_PRO || 'gemini-4-argon',
	modelFlash: env.GEMINI_MODEL_FLASH || 'gemini-3.8-flash'
};

export function setGeminiApiKey(key: string) {
	config.geminiApiKey = key.trim();
}
