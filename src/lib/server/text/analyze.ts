// Análisis local (sin IA) de texto japonés: segmentación por coincidencia más larga contra JMdict + deconjugación.
// Da tokens con lectura, glosa y estado, y estadísticas de cobertura para planificar qué estudiar antes de leer.
import type { DB } from '../db/index.ts';
import type { ItemStatus, JpToken, TextStats } from '../../types.ts';
import { deinflect, posMatches, T } from '../../deinflect.ts';
import { isKanjiChar, kanjiIn, isKana, toHiragana } from '../../jp.ts';
import { readableKanji } from '../items.ts';
import { State } from '../srs/fsrs.ts';

type Entry = {
	id: string;
	main_form: string;
	main_reading: string;
	kana_forms: string;
	pos: string;
	common: number;
	glosses_es: string | null;
	glosses_en: string;
};

export const MAX_ANALYZE_CHARS = 40_000;
const MAX_LEN = 14; // 「払われてしまいました」 = 10 kana + raíz

const isJp = (ch: string) => isKanjiChar(ch) || isKana(ch) || ch === 'ー' || ch === '々' || ch === 'ヶ';
const isHira = (ch: string) => /[ぁ-ゖ]/.test(ch);
const hasKatakana = (s: string) => /[ァ-ヺ]/.test(s);

function kanaSuffix(form: string) {
	let i = form.length;
	while (i > 0 && isKana(form[i - 1])) i--;
	return form.slice(i);
}

/** Lectura de la superficie conjugada a partir de la base: 食べた + (食べる, たべる) → たべた. */
function inflectedReading(surface: string, base: string, baseReading: string) {
	const baseSuf = toHiragana(kanaSuffix(base));
	const stem = baseReading.endsWith(baseSuf) ? baseReading.slice(0, baseReading.length - baseSuf.length) : baseReading;
	return stem + toHiragana(kanaSuffix(surface));
}

export function analyzeText(db: DB, text: string): { tokens: JpToken[]; stats: TextStats } {
	const client = db.$client;
	const qForm = client.query<Entry, [string]>(
		`select v.id, v.main_form, v.main_reading, v.kana_forms, v.pos, v.common, v.glosses_es, v.glosses_en
		 from vocab_form f join vocab v on v.id = f.vocab_id
		 where f.form = ?1 order by v.common desc, (v.main_form = ?1) desc limit 4`
	);
	const memo = new Map<string, Entry[]>();
	const find = (form: string) => {
		let r = memo.get(form);
		if (!r) memo.set(form, (r = qForm.all(form)));
		return r;
	};

	const status = new Map<string, ItemStatus>();
	for (const r of client
		.query<{ k: string; n: number; notReview: number; minStab: number }, []>(
			`select item_key as k, count(*) as n, sum(case when state != ${State.Review} then 1 else 0 end) as notReview, min(stability) as minStab
			 from card where item_type = 'vocab' group by item_key`
		)
		.all())
		status.set(r.k, r.notReview ? 'learning' : r.minStab >= 21 ? 'mastered' : 'review');
	const knownKanji = new Set(
		client
			.query<{ k: string }, []>(`select item_key as k from card where item_type = 'kanji' and facet = 'meaning' and state = ${State.Review}`)
			.all()
			.map((r) => r.k)
	);
	const readable = readableKanji(db);
	const kanjiRows = new Map(
		client
			.query<{ char: string; m: string; o: number | null }, []>('select char, meanings_es as m, learn_order as o from kanji')
			.all()
			.map((r) => [r.char, r])
	);

	const src = text.slice(0, MAX_ANALYZE_CHARS);
	const tokens: JpToken[] = [];
	let plain = '';
	const flush = () => {
		if (plain) tokens.push({ s: plain, p: 'puntuación' });
		plain = '';
	};

	let i = 0;
	while (i < src.length) {
		if (!isJp(src[i])) {
			plain += src[i++];
			continue;
		}
		flush();
		let run = 0;
		while (i + run < src.length && run < MAX_LEN && isJp(src[i + run])) run++;
		let matched: { len: number; e: Entry; base: string; reasons: string[] } | null = null;
		for (let len = run; len >= 1 && !matched; len--) {
			const sub = src.slice(i, i + len);
			const exact = find(sub);
			if (exact.length) {
				matched = { len, e: exact[0], base: sub, reasons: [] };
				break;
			}
			if (len > 1 && isHira(sub[sub.length - 1])) {
				for (const c of deinflect(sub)) {
					if (!c.reasons.length) continue;
					let es = find(c.term).filter((e) => posMatches(JSON.parse(e.pos), c.types));
					if (!es.length && c.types & T.VS && c.term.endsWith('する') && c.term.length > 2)
						es = find(c.term.slice(0, -2)).filter((e) => (JSON.parse(e.pos) as string[]).some((p) => p.startsWith('vs')));
					if (es.length) {
						matched = { len, e: es[0], base: c.term, reasons: c.reasons };
						break;
					}
				}
			}
		}
		if (!matched) {
			tokens.push({ s: src[i] });
			i++;
			continue;
		}
		const s = src.slice(i, i + matched.len);
		const e = matched.e;
		const gl = (JSON.parse(e.glosses_es ?? 'null') as string[] | null) ?? (JSON.parse(e.glosses_en) as string[]);
		const tok: JpToken = { s, b: matched.base, g: gl.slice(0, 2).join('; '), id: e.id };
		if (matched.reasons.length) tok.x = matched.reasons;
		if (kanjiIn(s).length) {
			const kana = JSON.parse(e.kana_forms) as string[];
			const baseReading = matched.base === e.main_form ? e.main_reading : (kana[0] ?? e.main_reading);
			tok.r = matched.reasons.length ? inflectedReading(s, matched.base, baseReading) : baseReading;
			const st = status.get(e.id);
			tok.k = kanjiIn(s).every((k) => readable.has(k)) || st === 'review' || st === 'mastered';
		}
		tokens.push(tok);
		i += matched.len;
	}
	flush();

	return { tokens, stats: textStats(tokens, status, knownKanji, kanjiRows, src.length) };
}

function textStats(
	tokens: JpToken[],
	status: Map<string, ItemStatus>,
	knownKanji: Set<string>,
	kanjiRows: Map<string, { char: string; m: string; o: number | null }>,
	chars: number
): TextStats {
	const words = tokens.filter((t) => t.p !== 'puntuación');
	const content = words.filter((t) => kanjiIn(t.s).length || hasKatakana(t.s));
	const known = (t: JpToken) => {
		const st = t.id ? status.get(t.id) : undefined;
		return st === 'review' || st === 'mastered';
	};
	const unknownWords = new Map<string, TextStats['unknownWords'][number]>();
	for (const t of content) {
		if (!t.id || known(t)) continue;
		const u = unknownWords.get(t.id);
		if (u) u.count++;
		else
			unknownWords.set(t.id, {
				id: t.id,
				form: t.b ?? t.s,
				reading: t.r ?? '',
				gloss: t.g ?? '',
				count: 1,
				common: true,
				kanji: kanjiIn(t.b ?? t.s).filter((k) => kanjiRows.has(k)),
				status: status.get(t.id) ?? 'none'
			});
	}
	const kanjiOcc = words.flatMap((t) => kanjiIn(t.s));
	const unknownKanji = new Map<string, TextStats['unknownKanji'][number]>();
	for (const k of kanjiOcc) {
		if (knownKanji.has(k) || !kanjiRows.has(k)) continue;
		const u = unknownKanji.get(k);
		if (u) u.count++;
		else {
			const row = kanjiRows.get(k)!;
			unknownKanji.set(k, { char: k, count: 1, meaning: (JSON.parse(row.m) as string[])[0] ?? '', learnOrder: row.o });
		}
	}
	const uw = [...unknownWords.values()].sort((a, b) => b.count - a.count || a.form.length - b.form.length);
	const uk = [...unknownKanji.values()].sort((a, b) => b.count - a.count || (a.learnOrder ?? 9e9) - (b.learnOrder ?? 9e9));
	const knownCount = content.filter(known).length;
	const coverage = content.length ? knownCount / content.length : 1;

	// Plan: palabras más frecuentes hasta ~+15 puntos de cobertura (máx. 20 palabras), con sus kanji no aprendidos.
	const planWords: string[] = [];
	let gained = 0;
	for (const w of uw) {
		if (planWords.length >= 20) break;
		if (content.length && (knownCount + gained) / content.length >= Math.min(0.98, coverage + 0.15) && planWords.length >= 5) break;
		planWords.push(w.id);
		gained += w.count;
	}
	const planKanji = [...new Set(uw.filter((w) => planWords.includes(w.id)).flatMap((w) => w.kanji))].filter((k) => !knownKanji.has(k));

	return {
		chars,
		words: words.length,
		contentWords: content.length,
		wordCoverage: coverage,
		kanjiCoverage: kanjiOcc.length ? kanjiOcc.filter((k) => knownKanji.has(k)).length / kanjiOcc.length : 1,
		unknownWords: uw.slice(0, 200),
		unknownKanji: uk.slice(0, 200),
		plan: {
			words: planWords,
			kanji: planKanji,
			coverageAfter: content.length ? Math.min(1, (knownCount + gained) / content.length) : 1
		}
	};
}
