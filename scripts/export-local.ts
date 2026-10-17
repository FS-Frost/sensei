// Migración desde la versión con servidor: exporta el progreso de una base local (por defecto data/sensei.db)
// al mismo .zip que genera Datos → Exportar, para importarlo en el sitio estático (Datos → Importar).
//
// Uso: bun run export:local [ruta/a/sensei.db] [salida.zip]
import { existsSync, writeFileSync } from 'node:fs';
import { openDb } from '../src/lib/server/db/bun.ts';
import { buildSnapshot, countSnapshot, snapshotToZip } from '../src/lib/server/data/snapshot.ts';

const src = process.argv[2] ?? 'data/sensei.db';
const out = process.argv[3] ?? `data/sensei-export-${new Date().toISOString().slice(0, 10)}.zip`;
if (!existsSync(src)) {
	console.error(`No existe ${src}`);
	process.exit(1);
}
const { db, sqlite } = openDb(src);
const snap = buildSnapshot(db);
const { zip } = snapshotToZip(snap, 'export');
sqlite.close();
writeFileSync(out, zip);
const counts = Object.entries(countSnapshot(snap))
	.filter(([, n]) => n > 0)
	.map(([k, n]) => `${n} ${k}`)
	.join(', ');
console.log(`Exportado ${out} (${(zip.byteLength / 1024).toFixed(0)} KB): ${counts || 'sin datos'}`);
console.log('Ábrelo en el sitio: Datos → Importar. La API key no viaja: vuelve a pegarla en Ajustes.');
