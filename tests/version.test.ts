// Aviso de actualización: «¿cambió la versión?» y «publicada hace N».
import { expect, test } from 'bun:test';
import { ago, noteVersion } from '../src/lib/client/version.ts';

function memory() {
	const m = new Map<string, string>();
	return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

test('noteVersion: primera visita sin aviso; cambio de sha con aviso una sola vez', () => {
	const s = memory();
	expect(noteVersion('7567fe4', s)).toBeNull(); // primera vez: nada que anunciar
	expect(noteVersion('7567fe4', s)).toBeNull(); // misma versión
	expect(noteVersion('f00de52', s)).toBe('7567fe4'); // actualizada
	expect(noteVersion('f00de52', s)).toBeNull(); // ya anunciada
	expect(noteVersion('dev', s)).toBeNull(); // en local nunca
	expect(noteVersion('abc1234', null)).toBeNull(); // sin almacenamiento
	const broken = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => {} };
	expect(noteVersion('abc1234', broken)).toBeNull();
});

test('ago: tiempo relativo en español', () => {
	const now = Date.parse('2026-10-17T12:00:00Z');
	const at = (s: number) => new Date(now - s * 1000).toISOString();
	expect(ago(at(20), now)).toBe('hace un momento');
	expect(ago(at(3 * 60), now)).toBe('hace 3 minutos');
	expect(ago(at(2 * 3600 + 50), now)).toBe('hace 2 horas');
	expect(ago(at(86400 + 10), now)).toBe('ayer');
	expect(ago(at(15 * 86400), now)).toBe('hace 2 semanas');
	expect(ago('no-es-fecha', now)).toBe('');
});
