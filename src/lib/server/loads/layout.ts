import { db, one } from '#lib/server/db/index.ts';
import { getSettings } from '#lib/server/settings.ts';
import { readableKanji } from '#lib/server/items.ts';
import { dueCount } from '#lib/server/srs/service.ts';
import { hasGemini } from '#lib/server/gemini/client.ts';
import { config } from '#lib/server/config.ts';
import { weakKanaChars } from '#lib/server/kana.ts';
import { sql } from 'drizzle-orm';

export const load = () => {
	const st = getSettings(db);
	const imported = (one<{ n: number }>(sql`select count(*) as n from kanji`)?.n ?? 0) > 0;
	const key = !!config.geminiApiKey;
	return {
		furigana: st.furigana,
		ttsEnabled: st.ttsEnabled,
		fontVariety: st.fontVariety,
		readable: [...readableKanji(db)].join(''),
		weakKana: weakKanaChars(db),
		due: dueCount(db),
		/** Se puede llamar a Gemini ahora (key y modo IA). */
		gemini: hasGemini(),
		/** Modo elegido: ask (sin decidir) · on · off. */
		aiMode: st.aiMode,
		/**
		 * Mostrar las funciones de IA en la interfaz: activada a mano, o sin decidir pero con key.
		 * Sin decidir y sin key no se muestran: se pregunta primero (client/ai.svelte.ts).
		 */
		aiUi: st.aiMode === 'on' || (st.aiMode === 'ask' && key),
		aiKey: key,
		onboardingDone: st.onboardingDone,
		imported
	};
};
