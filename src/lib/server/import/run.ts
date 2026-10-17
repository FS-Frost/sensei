import { sql, notInArray } from 'drizzle-orm';
import { RADICAL_NAMES_ES, RADICAL_SUBSTITUTES } from './radicals.ts';
import type { DB } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { loadAsset } from './download.ts';
import { isKanjiChar, kanjiIn } from '../../jp.ts';
import { computeLearnOrder } from './order.ts';
import { computeSimilar } from './similar.ts';

// ---- Tipos (subconjunto) de jmdict-simplified ----

type KdReading = { type: string; value: string };
type KdMeaning = { lang: string; value: string };
type KdChar = {
	literal: string;
	misc: { grade: number | null; strokeCounts: number[]; frequency: number | null; jlptLevel: number | null };
	readingMeaning: { groups: { readings: KdReading[]; meanings: KdMeaning[] }[] } | null;
};
type Kanjidic = { characters: KdChar[] };
type Kradfile = { kanji: Record<string, string[]> };
type Radkfile = { radicals: Record<string, { strokeCount: number }> };

type JmText = { common: boolean; text: string };
type JmGloss = { lang: string; text: string };
type JmExample = { sentences: { land?: string; lang?: string; text: string }[] };
type JmSense = { partOfSpeech: string[]; gloss: JmGloss[]; examples?: JmExample[] };
type JmWord = { id: string; kanji: JmText[]; kana: JmText[]; sense: JmSense[] };
type Jmdict = { words: JmWord[] };

export type ImportOptions = { full: boolean; examples: boolean; log?: (m: string) => void };

function chunked<T>(arr: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
}

export async function runImport(db: DB, opts: ImportOptions) {
	const log = opts.log ?? console.log;

	// ---------- Kanji ----------
	log('Kanji (KANJIDIC2)…');
	const kd = await loadAsset<Kanjidic>('kanjidic2-all', log);
	const krad = await loadAsset<Kradfile>('kradfile', log);
	const radk = await loadAsset<Radkfile>('radkfile', log);

	// Jōyō (grado 1-8) + cualquier kanji con frecuencia registrada.
	const chars = kd.characters.filter((c) => (c.misc.grade !== null && c.misc.grade <= 8) || c.misc.frequency !== null);
	const included = new Set(chars.map((c) => c.literal));

	const kanjiRows = chars.map((c) => {
		const groups = c.readingMeaning?.groups ?? [];
		const readings = groups.flatMap((g) => g.readings);
		const meanings = groups.flatMap((g) => g.meanings);
		return {
			char: c.literal,
			meaningsEs: meanings.filter((m) => m.lang === 'es').map((m) => m.value),
			meaningsEn: meanings.filter((m) => m.lang === 'en').map((m) => m.value),
			onReadings: readings.filter((r) => r.type === 'ja_on').map((r) => r.value),
			kunReadings: readings.filter((r) => r.type === 'ja_kun').map((r) => r.value),
			strokes: c.misc.strokeCounts[0] ?? null,
			grade: c.misc.grade,
			freq: c.misc.frequency,
			jlpt: c.misc.jlptLevel
		};
	});

	const decomposition = new Map<string, string[]>();
	const original = new Map<string, string>(); // radical real → símbolo usado en RADKFILE
	for (const k of included) {
		const comps = (krad.kanji[k] ?? []).map((c) => {
			const real = RADICAL_SUBSTITUTES[c] ?? c;
			original.set(real, c);
			return real;
		});
		decomposition.set(k, [...new Set(comps)].filter((c) => c !== k));
	}
	const strokesOf = (sym: string) => radk.radicals[original.get(sym) ?? sym]?.strokeCount ?? null;

	const order = computeLearnOrder(
		kanjiRows.map((k) => ({ char: k.char, freq: k.freq, grade: k.grade, strokes: k.strokes })),
		decomposition,
		(sym) => strokesOf(sym) ?? 99
	);

	const esByChar = new Map(kanjiRows.map((k) => [k.char, k.meaningsEs[0] ?? null]));
	const allSymbols = new Set<string>();
	for (const comps of decomposition.values()) comps.forEach((c) => allSymbols.add(c));

	db.transaction((tx) => {
		for (const batch of chunked(kanjiRows, 500)) {
			tx.insert(s.kanji)
				.values(batch.map((k) => ({ ...k, learnOrder: order.kanji.get(k.char) ?? null })))
				.onConflictDoUpdate({
					target: s.kanji.char,
					set: {
						meaningsEs: sql`excluded.meanings_es`,
						meaningsEn: sql`excluded.meanings_en`,
						onReadings: sql`excluded.on_readings`,
						kunReadings: sql`excluded.kun_readings`,
						strokes: sql`excluded.strokes`,
						grade: sql`excluded.grade`,
						freq: sql`excluded.freq`,
						jlpt: sql`excluded.jlpt`,
						learnOrder: sql`excluded.learn_order`
					}
				})
				.run();
		}
		const compRows = [...allSymbols].map((sym) => ({
			symbol: sym,
			// Nombre estático, o el significado si el componente es también un kanji.
			nameEs: RADICAL_NAMES_ES[sym] ?? esByChar.get(sym) ?? null,
			nameSource: RADICAL_NAMES_ES[sym] ? ('static' as const) : esByChar.get(sym) ? ('kanji' as const) : null,
			strokes: strokesOf(sym),
			learnOrder: order.components.get(sym) ?? null
		}));
		tx.delete(s.component).where(notInArray(s.component.symbol, [...allSymbols])).run();
		for (const batch of chunked(compRows, 500)) {
			tx.insert(s.component)
				.values(batch)
				.onConflictDoUpdate({
					target: s.component.symbol,
					set: {
						strokes: sql`excluded.strokes`,
						learnOrder: sql`excluded.learn_order`,
						// Conserva nombres ya generados por Gemini.
						nameEs: sql`coalesce(${s.component.nameEs}, excluded.name_es)`,
						nameSource: sql`case when ${s.component.nameEs} is null then excluded.name_source else ${s.component.nameSource} end`
					}
				})
				.run();
		}
		tx.delete(s.kanjiComponent).run();
		const kc = [...decomposition].flatMap(([k, comps]) => comps.map((sym, i) => ({ kanji: k, symbol: sym, position: i })));
		for (const batch of chunked(kc, 1000)) tx.insert(s.kanjiComponent).values(batch).onConflictDoNothing().run();
	});
	log(`  ${kanjiRows.length} kanji, ${allSymbols.size} componentes`);

	// ---------- Kanji parecidos ----------
	const similar = computeSimilar(
		kanjiRows.map((k) => ({ char: k.char, strokes: k.strokes })),
		decomposition
	);
	db.transaction((tx) => {
		for (const batch of chunked(similar, 500))
			tx.insert(s.similarKanji)
				.values(batch)
				// Conserva los consejos ya generados por Gemini.
				.onConflictDoUpdate({ target: [s.similarKanji.a, s.similarKanji.b], set: { score: sql`excluded.score` } })
				.run();
	});
	log(`  ${similar.length} pares de kanji parecidos`);

	// ---------- Vocabulario ----------
	log(`Vocabulario (JMdict ${opts.full ? 'completo' : 'común'})…`);
	const jm = await loadAsset<Jmdict>(opts.full ? 'jmdict-eng' : 'jmdict-eng-common', log);
	const spa = await loadAsset<Jmdict>('jmdict-spa', log);
	const esById = new Map<string, string[]>();
	for (const w of spa.words) {
		const gl = w.sense.flatMap((se) => se.gloss.filter((g) => g.lang === 'spa').map((g) => g.text));
		if (gl.length) esById.set(w.id, [...new Set(gl)].slice(0, 8));
	}

	const vocabRows: (typeof s.vocab.$inferInsert)[] = [];
	const formRows: { form: string; vocabId: string }[] = [];
	const vkRows: { vocabId: string; kanji: string }[] = [];
	for (const w of jm.words) {
		const id = `jm:${w.id}`;
		const kanjiForms = w.kanji.map((k) => k.text);
		const kanaForms = w.kana.map((k) => k.text);
		const common = w.kanji.some((k) => k.common) || w.kana.some((k) => k.common);
		const main = w.kanji.find((k) => k.common) ?? w.kanji[0];
		const mainKana = w.kana.find((k) => k.common) ?? w.kana[0];
		if (!mainKana) continue;
		const mainForm = main?.text ?? mainKana.text;
		const glossesEn = [...new Set(w.sense.slice(0, 4).flatMap((se) => se.gloss.map((g) => g.text)))].slice(0, 8);
		vocabRows.push({
			id,
			mainForm,
			mainReading: mainKana.text,
			kanjiForms,
			kanaForms,
			common,
			pos: w.sense[0]?.partOfSpeech ?? [],
			glossesEn,
			glossesEs: esById.get(w.id) ?? null,
			glossesEsSource: esById.has(w.id) ? 'jmdict' : null,
			source: 'jmdict'
		});
		for (const f of new Set([...kanjiForms, ...kanaForms])) formRows.push({ form: f, vocabId: id });
		if (common && main) for (const k of kanjiIn(main.text)) if (isKanjiChar(k)) vkRows.push({ vocabId: id, kanji: k });
	}

	db.transaction((tx) => {
		tx.delete(s.vocabForm).where(sql`${s.vocabForm.vocabId} like 'jm:%'`).run();
		tx.delete(s.vocabKanji).where(sql`${s.vocabKanji.vocabId} like 'jm:%'`).run();
		for (const batch of chunked(vocabRows, 400)) {
			tx.insert(s.vocab)
				.values(batch)
				.onConflictDoUpdate({
					target: s.vocab.id,
					set: {
						mainForm: sql`excluded.main_form`,
						mainReading: sql`excluded.main_reading`,
						kanjiForms: sql`excluded.kanji_forms`,
						kanaForms: sql`excluded.kana_forms`,
						common: sql`excluded.common`,
						pos: sql`excluded.pos`,
						glossesEn: sql`excluded.glosses_en`,
						// No pisar traducciones hechas por Gemini si JMdict-spa no tiene.
						glossesEs: sql`coalesce(excluded.glosses_es, vocab.glosses_es)`,
						glossesEsSource: sql`case when excluded.glosses_es is not null then 'jmdict' else vocab.glosses_es_source end`
					}
				})
				.run();
		}
		for (const batch of chunked(formRows, 2000)) tx.insert(s.vocabForm).values(batch).onConflictDoNothing().run();
		for (const batch of chunked(vkRows, 2000)) tx.insert(s.vocabKanji).values(batch).onConflictDoNothing().run();

		// Entradas JMdict de una importación anterior que ya no están en esta (p. ej. --full y luego sin --full):
		// sin formas no se encuentran. Se borran, salvo las que tienen tarjetas: a esas se les restauran las formas.
		tx.run(sql`
			insert or ignore into vocab_form (form, vocab_id)
			select j.value, v.id from vocab v, json_each(v.kanji_forms) j
			where v.id like 'jm:%' and not exists (select 1 from vocab_form f where f.vocab_id = v.id)
				and exists (select 1 from card c where c.item_type = 'vocab' and c.item_key = v.id)
			union all
			select j.value, v.id from vocab v, json_each(v.kana_forms) j
			where v.id like 'jm:%' and not exists (select 1 from vocab_form f where f.vocab_id = v.id)
				and exists (select 1 from card c where c.item_type = 'vocab' and c.item_key = v.id)
		`);
		const orphan = sql`id like 'jm:%' and not exists (select 1 from vocab_form f where f.vocab_id = vocab.id)`;
		const removed = tx.all<{ n: number }>(sql`select count(*) as n from vocab where ${orphan}`)[0]?.n ?? 0;
		if (removed) {
			tx.run(sql`delete from vocab where ${orphan}`);
			log(`  ${removed} entradas obsoletas eliminadas`);
		}
	});
	log(`  ${vocabRows.length} entradas (${vocabRows.filter((v) => v.common).length} comunes)`);

	// ---------- Frases de ejemplo (Tatoeba vía JMdict) ----------
	if (opts.examples) {
		log('Frases de ejemplo (Tatoeba)…');
		const ex = await loadAsset<Jmdict>('jmdict-examples-eng', log);
		const commonIds = new Set(vocabRows.filter((v) => v.common).map((v) => v.id));
		const rows: (typeof s.sentence.$inferInsert)[] = [];
		for (const w of ex.words) {
			const id = `jm:${w.id}`;
			if (!commonIds.has(id)) continue;
			for (const se of w.sense) {
				for (const e of se.examples ?? []) {
					const lang = (x: { land?: string; lang?: string }) => x.lang ?? x.land;
					const jp = e.sentences.find((x) => lang(x) === 'jpn')?.text;
					const en = e.sentences.find((x) => lang(x) === 'eng')?.text;
					if (jp) rows.push({ vocabId: id, jp, en: en ?? null, source: 'tatoeba' });
				}
			}
		}
		db.transaction((tx) => {
			tx.delete(s.sentence).where(sql`${s.sentence.source} = 'tatoeba'`).run();
			for (const batch of chunked(rows, 1000)) tx.insert(s.sentence).values(batch).run();
		});
		log(`  ${rows.length} frases`);
	}

	log('Listo.');
}
