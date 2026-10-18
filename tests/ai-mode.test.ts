// Modo IA: con `aiMode = 'off'` no hay llamadas a Gemini aunque haya key (hasGemini → false), el ajuste se normaliza,
// viaja al importar y restablecer los ajustes vuelve a «sin decidir».
import { afterEach, expect, test } from 'bun:test';
import { openDb } from '../src/lib/server/db/bun.ts';
import * as s from '../src/lib/server/db/schema.ts';
import { getSettings, resetSettings, syncAiMode, updateSettings } from '../src/lib/server/settings.ts';
import { config, setAiOff, setGeminiApiKey } from '../src/lib/server/config.ts';
import { ai, GeminiUnavailableError, hasGemini } from '../src/lib/server/gemini/client.ts';
import { setBackupStore } from '../src/lib/server/data/backups.ts';
import { memoryStore } from '../src/lib/server/data/store.ts';
import { buildSnapshot, snapshotToZip } from '../src/lib/server/data/snapshot.ts';
import { restoreFromZip } from '../src/lib/server/data/restore.ts';

const before = config.geminiApiKey;
afterEach(() => {
	setGeminiApiKey(before);
	setAiOff(false);
});

test('por defecto «sin decidir»; valores raros vuelven a ask', () => {
	const db = openDb(':memory:').db;
	expect(getSettings(db).aiMode).toBe('ask');
	expect(updateSettings(db, { aiMode: 'nada' as never }).aiMode).toBe('ask');
});

// tutor.test.ts reemplaza gemini/client.ts para TODO el proceso (hasGemini siempre true) y el orden de los archivos
// cambia según el SO: las comprobaciones de hasGemini()/ai() reales solo valen si el módulo no está simulado.
const realClient = hasGemini.toString().includes('aiOff');

test('modo sin IA: el interruptor se apaga aunque haya key, ai() lo explica; al reactivar vuelve', () => {
	const db = openDb(':memory:').db;
	setGeminiApiKey('AIzaClaveDePruebaQueNoSirve_1234567');
	if (realClient) expect(hasGemini()).toBe(true);
	updateSettings(db, { aiMode: 'off' });
	expect(config.aiOff).toBe(true);
	if (realClient) {
		expect(hasGemini()).toBe(false);
		expect(() => ai()).toThrow(GeminiUnavailableError);
		expect(() => ai()).toThrow('La IA está desactivada');
	}
	updateSettings(db, { aiMode: 'on' });
	expect(config.aiOff).toBe(false);
	if (realClient) expect(hasGemini()).toBe(true);
	// La key no se tocó.
	expect(config.geminiApiKey).toBe('AIzaClaveDePruebaQueNoSirve_1234567');
	updateSettings(db, { aiMode: 'off' });
	resetSettings(db);
	expect(getSettings(db).aiMode).toBe('ask');
	expect(config.aiOff).toBe(false);
});

test('importar los ajustes de otra copia aplica su modo IA', async () => {
	setBackupStore(memoryStore());
	const src = openDb(':memory:').db;
	updateSettings(src, { aiMode: 'off' });
	const zip = snapshotToZip(buildSnapshot(src), 'export').zip;
	setAiOff(false);

	const dst = openDb(':memory:').db;
	dst.insert(s.kanji).values({ char: '日', meaningsEs: ['sol'], learnOrder: 0 }).run();
	syncAiMode(dst);
	expect(config.aiOff).toBe(false);
	await restoreFromZip(dst, zip, { dry: false, backupKind: 'pre-import', sections: ['settings'] });
	expect(getSettings(dst).aiMode).toBe('off');
	expect(config.aiOff).toBe(true);
});
