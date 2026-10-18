// Diccionario del sitio estático: una base SQLite completa (catálogo cargado, tablas del alumno vacías)
// publicada en dict/<variante>/ comprimida con gzip y troceada (GitHub Pages no admite archivos > 100 MB).
// Instalar = descargar, descomprimir e importar como la base del navegador.
// Actualizar o cambiar de variante = snapshot de tus datos → base nueva → restaurar el snapshot
// (la misma maquinaria que exportar/importar; las mnemotecnias y traducciones viajan en el snapshot).
import { sql } from 'drizzle-orm';
import type { DB } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { DictManifest, DictVariant } from '../../backendProtocol.ts';
import { applySnapshot, buildSnapshot } from './snapshot.ts';
import { getInternal, setInternal } from '../settings.ts';

export async function fetchManifest(assets: string): Promise<DictManifest | null> {
	try {
		const res = await fetch(`${assets}/dict/manifest.json`, { cache: 'no-cache' });
		return res.ok ? ((await res.json()) as DictManifest) : null;
	} catch {
		return null;
	}
}

/** Descarga los trozos en orden y los descomprime en un solo Uint8Array (la base SQLite). */
export async function downloadDict(
	assets: string,
	manifest: DictManifest,
	variant: DictVariant,
	onProgress: (loaded: number, total: number) => void
): Promise<Uint8Array> {
	const build = manifest.variants[variant];
	if (!build) throw new Error(`El sitio no publica el diccionario «${variant}»`);
	let loaded = 0;
	const total = build.gzBytes;
	const parts = build.parts;
	// Un stream que concatena los trozos (el gzip está partido a ciegas, no por miembros).
	const gz = new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				for (const p of parts) {
					// `?v=`: los trozos se llaman igual en cada versión; sin esto la caché HTTP puede servir el de la anterior.
				const res = await fetch(`${assets}/dict/${variant}/${p.file}?v=${manifest.version}`);
					if (!res.ok || !res.body) throw new Error(`No se pudo descargar ${p.file} (${res.status})`);
					const reader = res.body.getReader();
					for (;;) {
						const { value, done } = await reader.read();
						if (done) break;
						loaded += value.byteLength;
						onProgress(loaded, total);
						controller.enqueue(value);
					}
				}
				controller.close();
			} catch (e) {
				controller.error(e);
			}
		}
	});
	const plain = gz.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
	const out = new Uint8Array(build.bytes);
	let offset = 0;
	const reader = plain.getReader();
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		if (offset + value.byteLength > out.byteLength) throw new Error('El diccionario descargado no coincide con el manifiesto');
		out.set(value, offset);
		offset += value.byteLength;
	}
	if (offset !== build.bytes) throw new Error('Descarga incompleta del diccionario');
	return out;
}

/** Valores internos (`_…`) que hay que conservar al cambiar de base: la API key, no los del build. */
export function internalSettings(db: DB) {
	return db
		.select()
		.from(s.setting)
		.where(sql`substr(${s.setting.key}, 1, 1) = '_'`)
		.all();
}

export function restoreInternals(db: DB, rows: { key: string; value: string }[]) {
	for (const r of rows)
		db.insert(s.setting).values(r).onConflictDoUpdate({ target: s.setting.key, set: { value: r.value } }).run();
}

export function markDict(db: DB, manifest: DictManifest, variant: DictVariant) {
	setInternal(db, 'dictVersion', manifest.version);
	setInternal(db, 'dictVariant', variant);
}

export function currentDict(db: DB) {
	return { version: getInternal(db, 'dictVersion'), variant: (getInternal(db, 'dictVariant') ?? 'common') as DictVariant };
}

/** Lo que hay que llevar de la base vieja a la nueva. */
export function captureUserData(db: DB) {
	return { snapshot: buildSnapshot(db), internals: internalSettings(db) };
}

export function restoreUserData(db: DB, data: ReturnType<typeof captureUserData>) {
	applySnapshot(db, data.snapshot);
	restoreInternals(db, data.internals);
}
