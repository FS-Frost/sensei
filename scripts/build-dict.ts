// Genera el diccionario del sitio estático: una base SQLite completa (catálogo cargado, tablas del alumno vacías),
// comprimida con gzip y troceada en partes < 100 MB (límite por archivo de GitHub Pages), más dict/manifest.json.
//
// Uso: bun run build:dict [--variants common,full] [--out static/dict] [--no-examples]
//   common = JMdict de palabras comunes (por defecto); full = JMdict completo (~219k entradas, descarga opcional).
// Las descargas de jmdict-simplified se cachean en data/raw/.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { sql } from 'drizzle-orm';
import { openDb } from '../src/lib/server/db/bun.ts';
import { runImport } from '../src/lib/server/import/run.ts';
import type { DictBuild, DictManifest, DictVariant } from '../src/lib/backendProtocol.ts';
import { applyPregen, type PregenContent } from '../src/lib/server/data/pregen.ts';

/** Contenido pregenerado versionado (scripts/pregen.ts). */
const PREGEN = 'content/pregen.json';

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const variants = opt('variants', 'common').split(',') as DictVariant[];
const out = opt('out', 'static/dict');
const examples = !args.includes('--no-examples');
const PART = 45 * 1024 * 1024;
const WORK = 'data/dict-build';

const t0 = performance.now();
mkdirSync(WORK, { recursive: true });
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const manifest: DictManifest = { version: '', createdAt: new Date().toISOString(), variants: {} };
const hash = createHash('sha256');

for (const variant of variants) {
	console.log(`\n=== Diccionario «${variant}» ===`);
	const path = join(WORK, `${variant}.db`);
	for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) rmSync(f);
	const { sqlite, db } = openDb(path, { wal: false });
	await runImport(db, { full: variant === 'full', examples });
	// Contenido pregenerado (scripts/pregen.ts): mnemotecnias, nombres, glosas… para empezar sin key ni gasto.
	if (existsSync(PREGEN)) {
		const n = applyPregen(db, JSON.parse(readFileSync(PREGEN, 'utf8')) as PregenContent);
		console.log(`  contenido pregenerado: ${n} valores`);
	}
	const count = (table: string) => db.all<{ n: number }>(sql.raw(`select count(*) as n from ${table}`))[0].n;
	const stats = { kanji: count('kanji'), vocab: count('vocab'), sentences: count('sentence') };
	// Formato compacto y sin WAL: sqlite-wasm importa el archivo tal cual.
	sqlite.exec('PRAGMA journal_mode = DELETE;');
	sqlite.exec('VACUUM;');
	sqlite.close();

	const bytes = readFileSync(path);
	const gz = gzipSync(bytes, { level: 9 });
	hash.update(bytes);
	mkdirSync(join(out, variant), { recursive: true });
	const parts: DictBuild['parts'] = [];
	for (let i = 0, n = 0; i < gz.byteLength; i += PART, n++) {
		const file = `part-${String(n).padStart(3, '0')}.bin`;
		const chunk = gz.subarray(i, i + PART);
		writeFileSync(join(out, variant, file), chunk);
		parts.push({ file, bytes: chunk.byteLength });
	}
	manifest.variants[variant] = { bytes: bytes.byteLength, gzBytes: gz.byteLength, parts, ...stats };
	const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
	console.log(`  base ${mb(bytes.byteLength)} → gzip ${mb(gz.byteLength)} en ${parts.length} parte(s)`);
}

// La versión cambia solo si cambia el contenido (así no se ofrece «actualizar» en cada despliegue).
manifest.version = hash.digest('hex').slice(0, 12);
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\nmanifest.json versión ${manifest.version} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
