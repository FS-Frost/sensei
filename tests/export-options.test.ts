// Exportar/importar con opciones: secciones, preferencias del dispositivo, API key cifrada, vista previa por sección,
// mnemotecnias personales y el paso de una exportación a contenido pregenerado (scripts/pregen-import.ts).
import { expect, test } from 'bun:test';
import { openDb } from '../src/lib/server/db/bun.ts';
import * as s from '../src/lib/server/db/schema.ts';
import { setBackupStore } from '../src/lib/server/data/backups.ts';
import { memoryStore } from '../src/lib/server/data/store.ts';
import { buildSnapshot, FORMAT, FORMAT_PARTIAL, readZip, snapshotToZip } from '../src/lib/server/data/snapshot.ts';
import { openSecret, sealSecret } from '../src/lib/server/data/secret.ts';
import { restoreFromZip } from '../src/lib/server/data/restore.ts';
import { emptyPregen, mergePregen, pregenFromSnapshot } from '../src/lib/server/data/pregen.ts';
import { getInternal, setInternal } from '../src/lib/server/settings.ts';
import { config } from '../src/lib/server/config.ts';

const KEY = 'AIzaClaveDePruebaQueNoSirve_1234567';

function base() {
	const db = openDb(':memory:').db;
	setBackupStore(memoryStore());
	db.insert(s.kanji)
		.values([
			{ char: '日', meaningsEs: ['sol'], learnOrder: 0, mnemonicMeaning: 'Un sol', mnemonicSource: 'gemini' },
			{ char: '月', meaningsEs: ['luna'], learnOrder: 1, mnemonicMeaning: 'Luna con tu gato', mnemonicSource: 'personal' },
			{ char: '目', meaningsEs: ['ojo'], learnOrder: 2, mnemonicMeaning: 'Un ojo', mnemonicSource: 'gemini' },
			{ char: '口', meaningsEs: ['boca'], learnOrder: 3, mnemonicMeaning: 'Boca', mnemonicSource: 'pregen' }
		])
		.run();
	db.insert(s.card).values({ itemType: 'kanji', itemKey: '日', facet: 'meaning', due: 0, fsrs: {}, createdAt: 0 }).run();
	// 目 se resistió: pudo regenerarse con /api/leech sin dejar registro.
	db.insert(s.card).values({ itemType: 'kanji', itemKey: '目', facet: 'meaning', due: 0, fsrs: { lapses: 7 }, createdAt: 0 }).run();
	db.insert(s.learnerNote).values({ note: 'le gustan los gatos', createdAt: 1 }).run();
	db.insert(s.setting).values({ key: 'kanjiPerDay', value: '7' }).run();
	setInternal(db, 'geminiApiKey', KEY);
	return db;
}

test('secreto: se abre con la contraseña y no con otra; contraseña corta, rechazada', async () => {
	const sealed = await sealSecret(KEY, 'contraseña-larga');
	expect(JSON.stringify(sealed)).not.toContain(KEY);
	expect(await openSecret(sealed, 'contraseña-larga')).toBe(KEY);
	await expect(openSecret(sealed, 'otra-contraseña')).rejects.toThrow('Contraseña incorrecta');
	await expect(sealSecret(KEY, 'corta')).rejects.toThrow('al menos 8');
});

test('exportación completa sigue en formato 1; parcial = formato 2 con sus secciones', () => {
	const db = base();
	const full = readZip(snapshotToZip(buildSnapshot(db), 'export').zip);
	expect(full.manifest.format).toBe(FORMAT);
	expect(full.sections).toHaveLength(6);
	const part = readZip(snapshotToZip(buildSnapshot(db), 'export', new Date(), { sections: ['tutor'], device: { 'sensei.theme': 'dark', x: 'no' } as never }).zip);
	expect(part.manifest.format).toBe(FORMAT_PARTIAL);
	expect(part.sections).toEqual(['tutor']);
	expect(part.snap.progress.cards).toEqual([]);
	expect(part.snap.tutor.notes).toHaveLength(1);
	// Solo claves sensei.* (lo demás se ignora al leer).
	expect(part.device).toEqual({ 'sensei.theme': 'dark' });
	expect(part.secret).toBeNull();
});

test('importar: vista previa por sección, reemplaza solo lo elegido, la key con contraseña', async () => {
	const src = base();
	const sealed = await sealSecret(KEY, 'contraseña-larga');
	const zip = snapshotToZip(buildSnapshot(src), 'export', new Date(), { secret: { geminiApiKey: sealed } }).zip;

	const dst = openDb(':memory:').db;
	dst.insert(s.kanji).values({ char: '日', meaningsEs: ['sol'], learnOrder: 0 }).run();
	dst.insert(s.learnerNote).values([{ note: 'mía', createdAt: 1 }, { note: 'mía 2', createdAt: 2 }]).run();
	const prev = await restoreFromZip(dst, zip, { dry: true, backupKind: 'pre-import' });
	expect(prev.hasKey).toBe(true);
	expect(prev.currentKey).toBe(false);
	expect(prev.sections.find((x) => x.id === 'tutor')).toMatchObject({ incoming: { notes: 1 }, current: { notes: 2 } });
	// Contraseña mal: ni siquiera en vista previa pasa, y nada cambia.
	await expect(restoreFromZip(dst, zip, { dry: false, backupKind: 'pre-import', sections: ['progress'], keyPassword: 'mal-contraseña' })).rejects.toThrow('Contraseña incorrecta');
	expect(dst.select().from(s.card).all()).toHaveLength(0);

	const r = await restoreFromZip(dst, zip, { dry: false, backupKind: 'pre-import', sections: ['progress'], keyPassword: 'contraseña-larga' });
	expect(r.applied).toEqual(['progress']);
	expect(r.keyApplied).toBe(true);
	expect(dst.select().from(s.card).all()).toHaveLength(2);
	// El tutor no se eligió: tus notas siguen.
	expect(dst.select().from(s.learnerNote).all().map((n) => n.note)).toEqual(['mía', 'mía 2']);
	expect(getInternal(dst, 'geminiApiKey')).toBe(KEY);
	expect(config.geminiApiKey).toBe(KEY);
});

test('mnemotecnias personales: viajan en tu copia con su origen, pero nunca pasan a pregenerado', () => {
	const db = base();
	const snap = buildSnapshot(db);
	// Lo pregenerado no se exporta; lo personal sí, marcado.
	expect(snap.content.mnemonics.map((m) => [m.char, m.source])).toEqual([
		['日', 'gemini'],
		['月', 'personal'],
		['目', 'gemini']
	]);
	// Pasa por el .zip, como haría scripts/pregen-import.ts.
	const c = pregenFromSnapshot(readZip(snapshotToZip(snap, 'export').zip).snap);
	expect(c.mnemonics.map((m) => m.char)).toEqual(['日']);
	expect(c.excluded.map((x) => x.char).sort()).toEqual(['月', '目']);

	const { content, added } = mergePregen(
		{ ...emptyPregen(), kanji: ['日'], mnemonics: [{ char: '日', meaning: 'YA PUBLICADA', reading: null }] },
		{ ...c, glosses: [{ id: 'jm:9', glosses: ['x'] }] }
	);
	expect(added).toMatchObject({ mnemonics: 0, glosses: 1 });
	expect(content.mnemonics).toEqual([{ char: '日', meaning: 'YA PUBLICADA', reading: null }]);
	expect(content.kanji).toEqual(['日']);
});
