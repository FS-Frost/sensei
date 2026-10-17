import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { strToU8, zipSync } from 'fflate';
import { openDb, type DB } from '../src/lib/server/db/bun.ts';
import * as s from '../src/lib/server/db/schema.ts';
import { deinflect } from '../src/lib/deinflect.ts';
import { lookupInflected, similarTo } from '../src/lib/server/items.ts';
import { analyzeText } from '../src/lib/server/text/analyze.ts';
import { computeSimilar } from '../src/lib/server/import/similar.ts';
import { GRAMMAR } from '../src/lib/grammar.ts';
import { enqueue, nextLesson, unlockedGrammar } from '../src/lib/server/srs/lessons.ts';
import { applyReview, buildReviewItem, ensureCard, gradeAnswer, leeches, pauseCard, LEECH_LAPSES } from '../src/lib/server/srs/service.ts';
import { State } from '../src/lib/server/srs/fsrs.ts';
import { mineSentence } from '../src/lib/server/text/sentences.ts';
import { epubToChapters, htmlToText, logReading, rereadsDue, srtToText, REREAD_DAYS } from '../src/lib/server/text/library.ts';
import { applyPlacement } from '../src/lib/server/srs/placement.ts';
import { goalStatus, nextSteps } from '../src/lib/server/guide.ts';
import { updateSettings } from '../src/lib/server/settings.ts';
import { applySnapshot, buildSnapshot, readZip, snapshotToZip } from '../src/lib/server/data/snapshot.ts';
import { applyReset, previewReset } from '../src/lib/server/data/reset.ts';
import { applyCalibration, calibrate, MIN_REVIEWS } from '../src/lib/server/srs/optimizer.ts';
import { weekMetrics } from '../src/lib/server/report.ts';

let db: DB;
const DAY = 86_400_000;

function seed() {
	db.insert(s.kanji)
		.values([
			{ char: '食', meaningsEs: ['comer'], onReadings: ['ショク'], kunReadings: ['た.べる'], learnOrder: 0, strokes: 9 },
			{ char: '見', meaningsEs: ['ver'], onReadings: ['ケン'], kunReadings: ['み.る'], learnOrder: 1, strokes: 7 },
			{ char: '未', meaningsEs: ['todavía no'], onReadings: ['ミ'], learnOrder: 2, strokes: 5 },
			{ char: '末', meaningsEs: ['final'], onReadings: ['マツ'], learnOrder: 3, strokes: 5 },
			{ char: '生', meaningsEs: ['vida'], onReadings: ['セイ'], kunReadings: ['い.きる', 'なま'], learnOrder: 4, strokes: 5 }
		])
		.run();
	const words: (typeof s.vocab.$inferInsert)[] = [
		{ id: 'jm:1', mainForm: '食べる', mainReading: 'たべる', kanjiForms: ['食べる'], kanaForms: ['たべる'], common: true, pos: ['v1', 'vt'], glossesEs: ['comer'] },
		{ id: 'jm:2', mainForm: '見る', mainReading: 'みる', kanjiForms: ['見る'], kanaForms: ['みる'], common: true, pos: ['v1'], glossesEs: ['ver'] },
		{ id: 'jm:3', mainForm: 'を', mainReading: 'を', kanaForms: ['を'], common: true, pos: ['prt'], glossesEs: ['(objeto)'] },
		{ id: 'jm:4', mainForm: '生', mainReading: 'なま', kanjiForms: ['生'], kanaForms: ['なま'], common: true, pos: ['n'], glossesEs: ['crudo'] },
		{ id: 'jm:5', mainForm: '猫', mainReading: 'ねこ', kanjiForms: ['猫'], kanaForms: ['ねこ'], common: true, pos: ['n'], glossesEs: ['gato'] }
	];
	db.insert(s.vocab).values(words).run();
	for (const w of words)
		for (const f of new Set([...(w.kanjiForms ?? []), ...(w.kanaForms ?? [])])) db.insert(s.vocabForm).values({ form: f, vocabId: w.id }).run();
	db.insert(s.vocabKanji).values([{ vocabId: 'jm:1', kanji: '食' }, { vocabId: 'jm:2', kanji: '見' }]).run();
	db.insert(s.similarKanji).values({ a: '未', b: '末', score: 1, tip: 'La raya larga arriba es el final.' }).run();
}

beforeEach(() => {
	db = openDb(':memory:').db;
	seed();
});

describe('deconjugación (2)', () => {
	test('cadenas típicas', () => {
		const bases = (w: string) => deinflect(w).map((c) => c.term);
		expect(bases('食べさせられなかった')).toContain('食べる');
		expect(bases('読んでいました')).toContain('読む');
		expect(bases('高くなかった')).toContain('高い');
		expect(bases('行った')).toContain('行く');
	});

	test('lookupInflected valida la categoría gramatical', () => {
		const r = lookupInflected(db, '見られなかった', 3);
		expect(r[0].mainForm).toBe('見る');
		expect(r[0].inflection?.reasons).toEqual(['pasiva / potencial', 'negativo', 'pasado']);
		// 猫 es sustantivo: no se «deconjuga» a partir de formas verbales
		expect(lookupInflected(db, '猫た', 3)).toEqual([]);
	});
});

describe('análisis de texto (4)', () => {
	test('coincidencia más larga + conjugaciones + lecturas', () => {
		const { tokens, stats } = analyzeText(db, '猫を見られなかった。');
		expect(tokens.map((t) => t.s)).toEqual(['猫', 'を', '見られなかった', '。']);
		const v = tokens[2];
		expect(v.b).toBe('見る');
		expect(v.r).toBe('みられなかった');
		expect(stats.contentWords).toBe(2);
		expect(stats.wordCoverage).toBe(0);
		expect(stats.plan.words).toContain('jm:5');
	});

	test('la cobertura sube con el vocabulario en repaso', () => {
		const c = ensureCard(db, 'vocab', 'jm:5', 'meaning');
		db.update(s.card).set({ state: State.Review, stability: 5 }).where(eq(s.card.id, c.id)).run();
		ensureCard(db, 'vocab', 'jm:5', 'reading');
		db.update(s.card).set({ state: State.Review, stability: 5 }).where(eq(s.card.itemKey, 'jm:5')).run();
		expect(analyzeText(db, '猫を見る').stats.wordCoverage).toBe(0.5);
	});
});

describe('kanji parecidos (3)', () => {
	test('cálculo por componentes + pares curados', () => {
		const pairs = computeSimilar(
			[
				{ char: '待', strokes: 9 },
				{ char: '持', strokes: 9 },
				{ char: '未', strokes: 5 },
				{ char: '末', strokes: 5 }
			],
			new Map([
				['待', ['彳', '土', '寸']],
				['持', ['扌', '土', '寸']],
				['未', ['木']],
				['末', ['木']]
			])
		);
		const keys = pairs.map((p) => `${p.a}${p.b}`);
		expect(keys).toContain('待持');
		expect(keys).toContain('未末');
	});

	test('en lección solo se avisa de los parecidos ya estudiados', () => {
		expect(similarTo(db, '末', { onlySeen: true })).toEqual([]);
		ensureCard(db, 'kanji', '未', 'meaning');
		const sim = similarTo(db, '末', { onlySeen: true });
		expect(sim[0].char).toBe('未');
		expect(sim[0].tip).toContain('final');
	});
});

describe('gramática (1)', () => {
	test('currículo coherente y desbloqueo por kanji', () => {
		expect(new Set(GRAMMAR.map((g) => g.id)).size).toBe(GRAMMAR.length);
		const meanings = GRAMMAR.map((g) => g.meaning);
		expect(new Set(meanings).size).toBe(meanings.length); // distractores siempre distintos
		expect(unlockedGrammar(db, 100).every((g) => g.unlockAt === 0)).toBe(true);
	});

	test('lección y tarjeta de opción múltiple', () => {
		updateSettings(db, { newKanjiPerDay: 0, newVocabPerDay: 0 });
		const { items } = nextLesson(db, 'auto');
		expect(items[0].type).toBe('grammar');
		const item = buildReviewItem(db, { id: null, itemType: 'grammar', itemKey: 'wa', facet: 'meaning' });
		expect(item.answerMode).toBe('choice');
		expect(item.options).toContain(item.answers[0]);
		expect(new Set(item.options).size).toBe(4);
		expect(gradeAnswer(db, 'grammar', 'wa', 'meaning', item.answers[0]).correct).toBe(true);
	});
});

describe('cola de estudio desde un texto (4)', () => {
	test('los kanji en cola van primero', () => {
		enqueue(db, [{ type: 'kanji', key: '生' }]);
		const { items } = nextLesson(db, 'kanji');
		expect(items[0].key).toBe('生');
	});
});

describe('frases en contexto (5)', () => {
	test('minar y repasar la lectura de la palabra en contexto', () => {
		const m = mineSentence(db, { jp: 'この生ビールは冷たい。', es: 'Esta cerveza de barril está fría.', target: '生', source: 'manual' });
		expect(m.targetReading).toBe('なま');
		const it = buildReviewItem(db, { id: null, itemType: 'sentence', itemKey: String(m.id), facet: 'reading' });
		expect(it.highlight).toBe('生');
		expect(gradeAnswer(db, 'sentence', String(m.id), 'reading', 'なま').correct).toBe(true);
		expect(gradeAnswer(db, 'sentence', String(m.id), 'reading', 'せい').correct).toBe(false);
	});

	test('la palabra debe aparecer en la frase', () => {
		expect(() => mineSentence(db, { jp: '猫が好き', target: '犬', source: 'manual' })).toThrow();
	});
});

describe('sanguijuelas (9)', () => {
	test('se detectan tras muchos fallos y se pueden apartar', () => {
		const c = ensureCard(db, 'kanji', '末', 'meaning');
		let t = Date.now() - 200 * DAY;
		let leech = false;
		// Un «lapso» es fallar estando en repaso: graduar (2 aciertos espaciados) y luego fallar.
		for (let i = 0; i < 20 && !leech; i++) {
			applyReview(db, c.id, { correct: true, source: 'review' }, new Date((t += 2 * DAY)));
			applyReview(db, c.id, { correct: true, source: 'review' }, new Date((t += 3 * DAY)));
			leech = applyReview(db, c.id, { correct: false, source: 'review' }, new Date((t += 3 * DAY))).leech;
		}
		expect(leech).toBe(true);
		const lapses = db.select().from(s.card).where(eq(s.card.id, c.id)).get()!.fsrs.lapses as number;
		expect(lapses).toBeGreaterThanOrEqual(LEECH_LAPSES);
		expect(leeches(db).map((l) => l.key)).toContain('末');
		const due = pauseCard(db, c.id, 7);
		expect(due).toBeGreaterThan(Date.now() + 6 * DAY);
	});
});

describe('biblioteca, relectura y velocidad (4, 6, 7)', () => {
	test('importadores de texto', () => {
		expect(srtToText('1\n00:00:01,000 --> 00:00:02,000\nこんにちは\n\n2\n00:00:03,000 --> 00:00:04,000\n<i>元気？</i>\n')).toBe('こんにちは\n元気？');
		expect(htmlToText('<p><ruby>漢字<rt>かんじ</rt></ruby>を読む</p>')).toBe('漢字を読む');
		const epub = zipSync({
			'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'),
			'OEBPS/content.opf': strToU8(
				'<package><manifest><item id="c1" href="ch1.xhtml"/><item id="c2" href="ch2.xhtml"/></manifest><spine><itemref idref="c2"/><itemref idref="c1"/></spine></package>'
			),
			'OEBPS/ch1.xhtml': strToU8('<html><head><title>Uno</title></head><body><p>' + 'あ'.repeat(40) + '</p></body></html>'),
			'OEBPS/ch2.xhtml': strToU8('<html><head><title>Dos</title></head><body><p>' + 'い'.repeat(40) + '</p></body></html>')
		});
		const ch = epubToChapters(epub);
		expect(ch.map((c) => c.title)).toEqual(['Dos', 'Uno']); // orden del spine
	});

	test('relectura espaciada y CPM', () => {
		const t = db.insert(s.libraryText).values({ title: 'T', content: '猫を見る', origin: 'paste', createdAt: 0 }).returning().get();
		const log = logReading(db, { textKind: 'library', textId: t.id, chars: 300, durationMs: 60_000, furigana: 'adaptive' });
		expect(log.cpm).toBe(300);
		expect(rereadsDue(db, Date.now())).toEqual([]);
		const due = rereadsDue(db, Date.now() + REREAD_DAYS[0] * DAY + 1000);
		expect(due[0].title).toBe('T');
	});
});

describe('objetivo con fecha (10)', () => {
	test('calcula ritmo necesario y avisa si no basta', () => {
		const in10 = new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10);
		updateSettings(db, { goal: { label: 'Leer X', kanji: 200, date: in10 }, newKanjiPerDay: 5 });
		const g = goalStatus(db)!;
		expect(g.remaining).toBe(200);
		expect(g.requiredPerDay).toBeGreaterThan(5);
		expect(g.onTrack).toBe(false);
		expect(nextSteps(db).some((st) => st.id === 'goal')).toBe(true);
	});
});

describe('test de nivel (13)', () => {
	test('marca conocidos sin consumir el cupo de hoy', () => {
		const r = applyPlacement(db, 2, ['生']);
		expect(r.kanji).toBe(3);
		const cards = db.select().from(s.card).all();
		expect(cards.every((c) => c.state === State.Review)).toBe(true);
		expect(cards.every((c) => c.due > Date.now())).toBe(true);
		expect(nextLesson(db, 'kanji').quota.kanjiLearnedToday).toBe(0);
	});
});

describe('calibración FSRS (12)', () => {
	test('exige historial suficiente; con él calcula y reprograma', async () => {
		await expect(calibrate(db)).rejects.toThrow(String(MIN_REVIEWS));
		// Historial sintético: 120 tarjetas × 4 repasos espaciados
		const now = Date.now();
		for (let i = 0; i < 120; i++) {
			const c = ensureCard(db, 'kanji', `k${i}`, 'meaning', new Date(now - 90 * DAY));
			let t = now - 90 * DAY;
			for (const [gap, ok] of [[0, true], [1, i % 4 !== 0], [3, true], [8, i % 6 !== 0]] as [number, boolean][]) {
				t += gap * DAY;
				applyReview(db, c.id, { correct: ok, source: 'review' }, new Date(t));
			}
		}
		const cal = await calibrate(db);
		expect(cal.params.length).toBeGreaterThanOrEqual(19);
		expect(cal.workloadBefore).toBeGreaterThan(0);
		const { updated } = applyCalibration(db, cal.params);
		expect(updated).toBe(120);
	}, 60_000);
});

describe('informe semanal (11) y datos', () => {
	test('métricas de la semana', () => {
		const c = ensureCard(db, 'kanji', '食', 'meaning', new Date(Date.now() - 10 * DAY));
		applyReview(db, c.id, { correct: true, source: 'review' }, new Date(Date.now() - 9 * DAY));
		applyReview(db, c.id, { correct: true, source: 'review' }, new Date(Date.now() - DAY));
		const m = weekMetrics(db);
		expect(m.reviews).toBe(1);
		expect(m.activeDays).toBe(1);
	});

	test('exportar/importar incluye frases, lecturas, biblioteca y cola', () => {
		mineSentence(db, { jp: 'この生ビール', target: '生', source: 'manual' });
		const t = db.insert(s.libraryText).values({ title: 'T', content: 'x', origin: 'paste', createdAt: 0 }).returning().get();
		logReading(db, { textKind: 'library', textId: t.id, chars: 10, durationMs: 5000, furigana: 'adaptive' });
		enqueue(db, [{ type: 'kanji', key: '見' }], t.id);
		const zip = snapshotToZip(buildSnapshot(db), 'export').zip;
		applyReset(db, { progress: 'all', library: true, tutor: true });
		expect(db.select().from(s.minedSentence).all()).toHaveLength(0);
		expect(db.select().from(s.libraryText).all()).toHaveLength(0);
		applySnapshot(db, readZip(zip).snap);
		expect(db.select().from(s.minedSentence).all()).toHaveLength(1);
		expect(db.select().from(s.libraryText).all()).toHaveLength(1);
		expect(db.select().from(s.readingLog).all()).toHaveLength(1);
		expect(db.select().from(s.studyQueue).all()).toHaveLength(1);
	});

	test('reiniciar vocabulario arrastra las frases; gramática aparte', () => {
		mineSentence(db, { jp: 'この生ビール', target: '生', source: 'manual' });
		ensureCard(db, 'grammar', 'wa', 'meaning');
		expect(previewReset(db, { progress: ['vocab'] }).minedSentences).toBe(1);
		applyReset(db, { progress: ['vocab'] });
		expect(db.select().from(s.minedSentence).all()).toHaveLength(0);
		expect(db.select().from(s.card).all().map((c) => c.itemType)).toEqual(['grammar']);
	});
});
