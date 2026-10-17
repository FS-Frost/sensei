// Lectura graduada y explicador: salida estructurada por tokens + validación contra el diccionario.
import { and, sql } from 'drizzle-orm';
import type { Part } from '@google/genai';
import type { DB } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { JpToken } from '../../types.ts';
import { hasKanji, kanjiIn, normalizeReading, isKana } from '../../jp.ts';
import { lookupWord, readableKanji, seenKanji } from '../items.ts';
import { knownGrammar, unlockedGrammar } from '../srs/lessons.ts';
import { GRAMMAR, GRAMMAR_BY_ID } from '../../grammar.ts';
import { generateJson, models } from './client.ts';

const TOKEN_SCHEMA = {
	type: 'object',
	properties: {
		s: { type: 'string', description: 'superficie tal como aparece en el texto' },
		r: { type: 'string', description: 'lectura en hiragana de la superficie; vacío si no tiene kanji' },
		b: { type: 'string', description: 'forma de diccionario (base)' },
		g: { type: 'string', description: 'glosa breve en español; vacío para puntuación' },
		p: { type: 'string', description: 'categoría: sustantivo, verbo, partícula, adjetivo-i, adjetivo-na, adverbio, auxiliar, puntuación, nombre propio, onomatopeya, otro' }
	},
	required: ['s', 'r', 'b', 'g', 'p']
};

const TOKEN_RULES =
	'Tokeniza el japonés en palabras/morfemas (partículas y auxiliares aparte; la puntuación como token propio). ' +
	'La concatenación de "s" debe reproducir exactamente el texto. "r" es la lectura en hiragana SOLO de tokens con kanji.';

function kanaSuffix(form: string): string {
	let i = form.length;
	while (i > 0 && isKana(form[i - 1])) i--;
	return form.slice(i);
}

function kanaPrefix(form: string): string {
	let i = 0;
	while (i < form.length && isKana(form[i])) i++;
	return form.slice(0, i);
}

/** Lectura de la parte con kanji: quita okurigana (final) y kana inicial (お茶 → ちゃ). */
function stemReading(form: string, reading: string): string | null {
	const r = normalizeReading(reading);
	const suf = normalizeReading(kanaSuffix(form));
	const pre = normalizeReading(kanaPrefix(form));
	if (suf && !r.endsWith(suf)) return null;
	if (pre && !r.startsWith(pre)) return null;
	return r.slice(pre.length, r.length - suf.length);
}

export function validateTokens(db: DB, tokens: JpToken[], readable = readableKanji(db)): JpToken[] {
	return tokens.map((t) => {
		const out: JpToken = { ...t };
		for (const key of ['r', 'b', 'g', 'p'] as const) if (out[key] === '') delete out[key];
		if (!hasKanji(t.s)) {
			delete out.r;
			return out;
		}
		out.k = kanjiIn(t.s).every((k) => readable.has(k));
		if (!t.r) return out;
		const candidates = [...lookupWord(db, t.s, 8), ...(t.b && t.b !== t.s ? lookupWord(db, t.b, 8) : [])];
		if (!candidates.length) return out;
		const mine = stemReading(t.s, t.r);
		if (mine === null) {
			out.v = false;
			return out;
		}
		out.v = candidates.some((c) =>
			[...c.kanjiForms, c.mainForm].some((form) => {
				if (form !== t.s && form !== t.b) return false;
				return c.kanaForms.some((kana) => {
					// Para la forma base el okurigana difiere (食べる vs 食べた): compara solo la raíz.
					const theirs = stemReading(form, kana);
					return theirs !== null && (theirs === mine || normalizeReading(kana) === normalizeReading(t.r!));
				});
			})
		);
		return out;
	});
}

// ---------- Lectura graduada ----------

export type ReadingStyle = 'manga' | 'novela' | 'cartel' | 'juego' | 'web' | 'noticia';
export type ReadingLength = 'corto' | 'medio' | 'largo';

export type GradedReading = {
	title: string;
	lines: { speaker?: string; tokens: JpToken[]; es: string }[];
	new_words: { word: string; reading: string; es: string }[];
	questions: { q: string; options: string[]; answer_index: number; explanation: string }[];
	stats?: { known: string[]; allowedNew: string[]; outside: string[]; coverage: number };
};

const STYLE_DESC: Record<ReadingStyle, string> = {
	manga: 'diálogo de manga: frases cortas y coloquiales, con "speaker" para cada viñeta, alguna onomatopeya',
	novela: 'fragmento narrativo de novela ligera en estilo literario sencillo (forma だ/である o pasado llano)',
	cartel: 'carteles, avisos y menús de la vida real en Japón (varias líneas independientes)',
	juego: 'textos de interfaz y diálogos de un videojuego RPG (menús, misiones, NPC)',
	web: 'post de blog o red social, tono casual',
	noticia: 'noticia breve en estilo periodístico simplificado'
};

const LENGTH_LINES: Record<ReadingLength, string> = { corto: '4-6', medio: '8-12', largo: '14-20' };

function nextNewKanji(db: DB, n: number): string[] {
	return db
		.select({ c: s.kanji.char })
		.from(s.kanji)
		.where(
			and(
				sql`${s.kanji.learnOrder} is not null`,
				sql`not exists (select 1 from card where item_type = 'kanji' and item_key = ${s.kanji.char})`
			)
		)
		.orderBy(s.kanji.learnOrder)
		.limit(n)
		.all()
		.map((r) => r.c);
}

export async function generateGradedReading(
	db: DB,
	params: { style: ReadingStyle; length: ReadingLength; topic?: string }
): Promise<{ id: number; reading: GradedReading }> {
	const known = [...seenKanji(db)];
	const allowedNew = nextNewKanji(db, 2);
	const grammarKnown = knownGrammar(db).map((g) => g.pattern);
	const grammarNew = unlockedGrammar(db, 1)[0];
	const raw = await generateJson<GradedReading>({
		db,
		feature: 'reading',
		model: models(db).pro,
		system:
			'Eres un autor de lecturas graduadas en japonés para hispanohablantes que aprenden a LEER. ' +
			'Sigues la hipótesis i+1: casi todo comprensible, con un pequeño reto.',
		contents:
			`Escribe un texto original de tipo: ${STYLE_DESC[params.style]}.\n` +
			`Longitud: ${LENGTH_LINES[params.length]} líneas.\n` +
			(params.topic ? `Tema: ${params.topic}\n` : '') +
			`Kanji que el lector conoce (úsalos con libertad): ${known.join('') || '(ninguno todavía)'}\n` +
			`Kanji NUEVOS permitidos (úsalos 1-3 veces): ${allowedNew.join('') || '(ninguno)'}\n` +
			'Cualquier otra palabra escríbela en kana (hiragana o katakana según corresponda). NO uses otros kanji.\n' +
			(grammarKnown.length
				? `Gramática que el lector ya estudió (apóyate en ella): ${grammarKnown.join(', ')}\n`
				: 'El lector apenas sabe gramática: frases muy simples (です/だ, は, が, を).\n') +
			(grammarNew ? `Punto gramatical NUEVO que puedes introducir 1 vez: ${grammarNew.pattern} (${grammarNew.meaning})\n` : '') +
			TOKEN_RULES +
			'\n"es": traducción natural al español de cada línea. "new_words": palabras útiles del texto. ' +
			'"questions": 3 preguntas de comprensión en español (opción múltiple, 4 opciones).',
		schema: {
			type: 'object',
			properties: {
				title: { type: 'string' },
				lines: {
					type: 'array',
					items: {
						type: 'object',
						properties: { speaker: { type: 'string' }, tokens: { type: 'array', items: TOKEN_SCHEMA }, es: { type: 'string' } },
						required: ['tokens', 'es']
					}
				},
				new_words: {
					type: 'array',
					items: {
						type: 'object',
						properties: { word: { type: 'string' }, reading: { type: 'string' }, es: { type: 'string' } },
						required: ['word', 'reading', 'es']
					}
				},
				questions: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							q: { type: 'string' },
							options: { type: 'array', items: { type: 'string' } },
							answer_index: { type: 'integer' },
							explanation: { type: 'string' }
						},
						required: ['q', 'options', 'answer_index', 'explanation']
					}
				}
			},
			required: ['title', 'lines', 'new_words', 'questions']
		},
		temperature: 0.9
	});

	const readable = readableKanji(db);
	const knownSet = new Set([...known, ...allowedNew]);
	const used = raw.lines.flatMap((l) => l.tokens.flatMap((t) => kanjiIn(t.s)));
	const outside = [...new Set(used.filter((k) => !knownSet.has(k)))];
	const reading: GradedReading = {
		...raw,
		lines: raw.lines.map((l) => ({ ...l, tokens: validateTokens(db, l.tokens, readable) })),
		stats: {
			known: [...new Set(used.filter((k) => known.includes(k)))],
			allowedNew,
			outside,
			coverage: used.length ? used.filter((k) => knownSet.has(k)).length / used.length : 1
		}
	};
	const row = db
		.insert(s.generatedText)
		.values({ kind: 'reading', params, content: reading, createdAt: Date.now() })
		.returning({ id: s.generatedText.id })
		.get();
	return { id: row.id, reading };
}

// ---------- Explicador ----------

export type Explanation = {
	transcription: string;
	sentences: {
		tokens: JpToken[];
		es: string;
		/** `id`: punto del currículo de Sensei, si corresponde (para ofrecer «aprender este punto»). */
		grammar: { pattern: string; explanation: string; id?: string; studied?: boolean }[];
	}[];
	notes: string;
};

const GRAMMAR_CATALOG = GRAMMAR.map((g) => `${g.id}=${g.pattern}`).join('; ');

export async function explainText(
	db: DB,
	input: { text?: string; image?: { mimeType: string; data: string } }
): Promise<{ id: number; explanation: Explanation }> {
	const parts: Part[] = [];
	if (input.image) parts.push({ inlineData: { mimeType: input.image.mimeType, data: input.image.data } });
	parts.push({
		text:
			(input.image
				? 'Transcribe todo el texto japonés de la imagen (manga: en orden de lectura, derecha a izquierda). '
				: '') +
			(input.text ? `Texto: ${input.text}\n` : '') +
			'Desglosa cada oración para un hispanohablante que aprende a leer. ' +
			TOKEN_RULES +
			'\n"grammar": puntos gramaticales relevantes (patrón y explicación breve en español). Si el punto coincide con uno de ' +
			`este catálogo, pon su "id" exacto; si no, deja "id" vacío. Catálogo: ${GRAMMAR_CATALOG}. ` +
			'"notes": contexto cultural, registro o matices (puede ir vacío).'
	});
	const raw = await generateJson<Explanation>({
		db,
		feature: 'explain',
		model: models(db).pro,
		system: 'Eres un profesor de japonés paciente y preciso. Explicas en español. Nunca uses romaji.',
		contents: [{ role: 'user', parts }],
		schema: {
			type: 'object',
			properties: {
				transcription: { type: 'string' },
				sentences: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							tokens: { type: 'array', items: TOKEN_SCHEMA },
							es: { type: 'string' },
							grammar: {
								type: 'array',
								items: {
									type: 'object',
									properties: { pattern: { type: 'string' }, explanation: { type: 'string' }, id: { type: 'string' } },
									required: ['pattern', 'explanation']
								}
							}
						},
						required: ['tokens', 'es', 'grammar']
					}
				},
				notes: { type: 'string' }
			},
			required: ['transcription', 'sentences', 'notes']
		},
		temperature: 0.2
	});
	const readable = readableKanji(db);
	const studied = new Set(knownGrammar(db).map((g) => g.id));
	const explanation: Explanation = {
		...raw,
		sentences: raw.sentences.map((x) => ({
			...x,
			tokens: validateTokens(db, x.tokens, readable),
			grammar: x.grammar.map((g) => {
				const id = g.id && GRAMMAR_BY_ID.has(g.id) ? g.id : undefined;
				return { pattern: g.pattern, explanation: g.explanation, id, studied: id ? studied.has(id) : undefined };
			})
		}))
	};
	const row = db
		.insert(s.generatedText)
		.values({
			kind: 'explain',
			params: { text: input.text ?? null, image: !!input.image },
			content: explanation,
			createdAt: Date.now()
		})
		.returning({ id: s.generatedText.id })
		.get();
	return { id: row.id, explanation };
}
