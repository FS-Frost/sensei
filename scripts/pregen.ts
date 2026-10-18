// Pregenera contenido (mnemotecnias, nombres y explicaciones de componentes, glosas, frases, consejos de parecidos) de los primeros N kanji
// del orden de aprendizaje y lo guarda en data/pregen/content/pregen.json, que build-dict publica con el diccionario.
//
// Uso: GEMINI_API_KEY=… bun run pregen [--kanji 500] [--batch 8] [--dry]
//   Incremental y reanudable: lee content/pregen.json, salta lo que ya tiene y guarda tras cada tanda. Para ampliar,
//   vuelve a ejecutarlo con un --kanji mayor. Modelos: los del perfil por defecto, o GEMINI_MODEL_PRO / GEMINI_MODEL_FLASH.
// Necesita la base del diccionario: data/dict-build/common.db (bun run build:dict) o la construye.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { openDb } from '../src/lib/server/db/bun.ts';
import { setDb } from '../src/lib/server/db/index.ts';
import { runImport } from '../src/lib/server/import/run.ts';
import { config } from '../src/lib/server/config.ts';
import { applyPregen, collectGenerated, emptyPregen, kanjiInOrder, PREGEN_FORMAT, type PregenContent } from '../src/lib/server/data/pregen.ts';
import { componentsMissingExplanation, pregenerateBatch } from '../src/lib/server/gemini/pregen.ts';
import { ensureComponentExplanations } from '../src/lib/server/gemini/enrich.ts';

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const target = Number(opt('kanji', '500'));
const batch = Number(opt('batch', '8'));
const dry = args.includes('--dry');
// Versionado en el repo (lo lee build-dict en el CI); la base de trabajo, no (data/ está en .gitignore).
const OUT = 'content/pregen.json';
const WORK = 'data/pregen/work.db';

if (!config.geminiApiKey && !dry) {
	console.error('Falta GEMINI_API_KEY (o usa --dry para ver qué haría).');
	process.exit(1);
}

mkdirSync('data/pregen', { recursive: true });
mkdirSync('content', { recursive: true });
if (!existsSync(WORK)) {
	if (existsSync('data/dict-build/common.db')) copyFileSync('data/dict-build/common.db', WORK);
	else {
		console.log('Construyendo la base del diccionario (común)…');
		const { db } = openDb(WORK, { wal: false });
		await runImport(db, { full: false, examples: true });
	}
}
const { db } = openDb(WORK, { wal: false });
setDb(db);

const content: PregenContent = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as PregenContent) : emptyPregen();
console.log(`content/pregen.json: ${content.kanji.length} kanji ya procesados; aplicando ${applyPregen(db, content)} valores…`);

const chars = kanjiInOrder(db, target);
const pending = chars.filter(
	(c) => !(db.all<{ n: number }>(sql`select count(*) as n from kanji where char = ${c} and mnemonic_meaning is not null`)[0]?.n ?? 0)
);
const unexplained = () => componentsMissingExplanation(db, chars);
console.log(
	`Objetivo: ${chars.length} kanji · faltan ${pending.length} · componentes sin explicar ${unexplained().length} · ` +
		`modelos ${config.modelPro} / ${config.modelFlash}`
);
if (dry) process.exit(0);

function save(done: string[]) {
	const merged: PregenContent = {
		format: PREGEN_FORMAT,
		updatedAt: new Date().toISOString(),
		kanji: chars.filter((c) => done.includes(c) || content.kanji.includes(c)),
		...collectGenerated(db, chars)
	};
	writeFileSync(OUT, JSON.stringify(merged, null, '\t') + '\n');
	return merged;
}

const done = [...content.kanji];
for (let i = 0; i < pending.length; i += batch) {
	const part = pending.slice(i, i + batch);
	const t0 = performance.now();
	try {
		await pregenerateBatch(db, part);
	} catch (e) {
		console.error(`  tanda ${part.join('')} falló: ${e instanceof Error ? e.message : e}. Se guarda lo hecho; vuelve a ejecutar para seguir.`);
		save(done);
		process.exit(1);
	}
	done.push(...part);
	const m = save(done);
	const usd = db.all<{ usd: number }>(sql`select coalesce(sum(cost_usd), 0) as usd from gemini_usage`)[0].usd;
	console.log(
		`  ${Math.min(i + batch, pending.length)}/${pending.length} ${part.join('')} (${((performance.now() - t0) / 1000).toFixed(1)} s) · ` +
			`${m.mnemonics.length} mnemotecnias · ${m.glosses.length} glosas · $${usd.toFixed(3)} en total`
	);
}
// Componentes de kanji procesados antes de que existieran las explicaciones (o cuya tanda falló a medias).
const rest = unexplained();
for (let i = 0; i < rest.length; i += 20) {
	const part = rest.slice(i, i + 20);
	try {
		await ensureComponentExplanations(db, part);
	} catch (e) {
		console.error(`  componentes ${part.join('')} fallaron: ${e instanceof Error ? e.message : e}. Vuelve a ejecutar para seguir.`);
		save(done);
		process.exit(1);
	}
	const m = save(done);
	const usd = db.all<{ usd: number }>(sql`select coalesce(sum(cost_usd), 0) as usd from gemini_usage`)[0].usd;
	console.log(`  componentes ${Math.min(i + 20, rest.length)}/${rest.length} · ${m.componentExplanations?.length ?? 0} explicados · $${usd.toFixed(3)} en total`);
}
console.log(`\nListo: ${OUT}. Publica con: bun run build:dict`);
