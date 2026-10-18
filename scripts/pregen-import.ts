// Pasa lo que generaste en la app (una exportación .zip) a content/pregen.json, para publicarlo con el diccionario
// y que nadie tenga que volver a pagarlo. Solo suma lo que falta; no pisa nada ya publicado.
//
// Uso: bun run pregen:import <exportación.zip> [--dry]
//   --dry: muestra qué añadiría y qué excluye, sin escribir.
// Nunca publica mnemotecnias personales (hechas con tus intereses): ver pregenFromSnapshot en data/pregen.ts.
// Después: bun run build:dict (o el CI al hacer push).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readZip, SnapshotError } from '../src/lib/server/data/snapshot.ts';
import { emptyPregen, mergePregen, pregenFromSnapshot, type PregenContent } from '../src/lib/server/data/pregen.ts';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const file = args.find((a) => !a.startsWith('--'));
const OUT = 'content/pregen.json';

if (!file || !existsSync(file)) {
	console.error('Uso: bun run pregen:import <exportación.zip> [--dry]');
	process.exit(1);
}

let zip;
try {
	zip = readZip(new Uint8Array(readFileSync(file)));
} catch (e) {
	console.error(e instanceof SnapshotError ? `No se pudo leer: ${e.message}` : e);
	process.exit(1);
}
if (!zip.sections.includes('content')) {
	console.error('La exportación no trae «Contenido generado»: expórtala con esa sección.');
	process.exit(1);
}
if (!zip.sections.includes('progress') || !zip.sections.includes('tutor'))
	console.warn(
		'Aviso: sin «Progreso» y «Memoria del tutor» no se pueden detectar las mnemotecnias regeneradas sin marca: solo se excluyen las marcadas como personales.'
	);

const candidate = pregenFromSnapshot(zip.snap);
const base: PregenContent = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as PregenContent) : emptyPregen();
const { content, added } = mergePregen(base, candidate);

console.log(`Exportación del ${zip.manifest.createdAt.slice(0, 10)} → ${OUT}${dry ? ' (simulación)' : ''}`);
const LABEL: Record<string, string> = {
	mnemonics: 'mnemotecnias',
	componentNames: 'nombres de componentes',
	componentExplanations: 'explicaciones de componentes',
	glosses: 'glosas',
	sentences: 'frases',
	similarTips: 'consejos de parecidos'
};
for (const [k, n] of Object.entries(added)) console.log(`  + ${n} ${LABEL[k] ?? k}`);
if (candidate.excluded.length) {
	console.log(`  Excluidas ${candidate.excluded.length} mnemotecnias (no se publican):`);
	for (const x of candidate.excluded) console.log(`    ${x.char}: ${x.reason}`);
}
const total = Object.values(added).reduce((a, b) => a + b, 0);
if (dry) process.exit(0);
if (!total) {
	console.log('Nada nuevo que añadir.');
	process.exit(0);
}
writeFileSync(OUT, JSON.stringify(content, null, '\t') + '\n');
console.log(`\nListo: ${total} valores nuevos. Publica con: bun run build:dict (o haz push y lo hace el CI).`);
