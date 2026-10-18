// Lógica compartida página ↔ service worker: recordatorio de repasos y bandeja de lo compartido.
import { expect, test } from 'bun:test';
import { dayKey, dueAt, fileKind, hasJapanese, reminderText, sharedText, toNotify, type Schedule } from '../src/lib/client/pwa-core.ts';
import { openDb } from '../src/lib/server/db/bun.ts';
import * as s from '../src/lib/server/db/schema.ts';
import { upcomingDue } from '../src/lib/server/srs/service.ts';

const at = (h: number, d = 17) => new Date(2026, 9, d, h, 30);

test('recordatorio: avisa una vez al día, fuera de 22-8 h, solo si hay pendientes y está activado', () => {
	const now = at(12).getTime();
	const s: Schedule = { due: [now - 3600_000, now - 60_000, now + 3600_000], enabled: true, writtenAt: now };
	expect(dueAt(s, now)).toBe(2); // el tercero aún no vence
	expect(toNotify(s, at(12), null)).toBe(2);
	expect(toNotify(s, at(12), dayKey(at(9)))).toBe(0); // ya avisado hoy
	expect(toNotify(s, at(12), dayKey(at(9, 16)))).toBe(2); // ayer no cuenta
	expect(toNotify(s, at(23), null)).toBe(0); // horas de silencio
	expect(toNotify(s, at(7), null)).toBe(0);
	expect(toNotify({ ...s, enabled: false }, at(12), null)).toBe(0);
	expect(toNotify({ ...s, due: [now + 1] }, at(12), null)).toBe(0); // nada vencido
	// Lo que no vencía al escribir, vence después: el SW lo cuenta sin abrir la base.
	expect(dueAt(s, now + 2 * 3600_000)).toBe(3);
	expect(reminderText(1)).toBe('Tienes 1 repaso pendiente. ¡Unos minutos bastan!');
	expect(reminderText(5)).toContain('5 repasos pendientes');
});

test('bandeja: tipo de cada archivo y texto compartido', () => {
	expect(fileKind('foto.jpg', 'image/jpeg')).toBe('image');
	expect(fileKind('captura', 'image/png')).toBe('image');
	expect(fileKind('capítulo.txt', '')).toBe('library');
	expect(fileKind('anime.SRT', 'application/octet-stream')).toBe('library');
	expect(fileKind('novela.epub', 'application/epub+zip')).toBe('library');
	expect(fileKind('sensei-export-2026-10-17.zip', '')).toBe('backup');
	expect(fileKind('doc.pdf', 'application/pdf')).toBe('other');
	expect(hasJapanese('これは日本語')).toBe(true);
	expect(hasJapanese('only english')).toBe(false);
	expect(sharedText({ text: '猫が好き https://x.jp/a', url: 'https://x.jp/a' })).toBe('猫が好き');
	expect(sharedText({ url: 'https://x.jp/a' })).toBe('');
});

test('upcomingDue: vencimientos ordenados, sin suspendidas ni lejanas', () => {
	const db = openDb(':memory:').db;
	const now = Date.now();
	const card = (key: string, due: number, suspended = false) =>
		db
			.insert(s.card)
			.values({ itemType: 'kana', itemKey: key, facet: 'reading', state: 2, due, stability: 1, fsrs: {}, suspended, createdAt: now })
			.run();
	card('あ', now + 3600_000);
	card('い', now - 60_000);
	card('う', now - 120_000, true);
	card('え', now + 30 * 86_400_000);
	expect(upcomingDue(db, now + 8 * 86_400_000)).toEqual([now - 60_000, now + 3600_000]);
});
