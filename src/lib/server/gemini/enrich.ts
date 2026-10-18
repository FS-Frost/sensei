// Contenido generado por Gemini y cacheado en SQLite: nombres de componentes, mnemotecnias, glosas y frases en español.
import { eq, inArray, isNull, and } from 'drizzle-orm';
import type { DB } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { generateJson, hasGemini, models } from './client.ts';
import { getComponentInfo } from '../items.ts';
import type { ComponentExplanation } from '../../types.ts';

const SYSTEM =
	'Eres un profesor de japonés para hispanohablantes cuyo objetivo es aprender a LEER japonés. ' +
	'Escribes en español neutro, claro y breve. Nunca uses romaji.';

export async function ensureComponentNames(db: DB, symbols: string[]) {
	if (!hasGemini() || !symbols.length) return;
	const missing = db
		.select()
		.from(s.component)
		.where(and(inArray(s.component.symbol, symbols), isNull(s.component.nameEs)))
		.all();
	if (!missing.length) return;
	const res = await generateJson<{ items: { symbol: string; name_es: string }[] }>({
		db,
		feature: 'component_names',
		model: models(db).flash,
		system: SYSTEM,
		contents:
			'Da un nombre corto en español (1-3 palabras) a cada componente/radical de kanji, ' +
			'pensado para construir mnemotecnias visuales (estilo WaniKani). ' +
			`Componentes: ${missing.map((m) => m.symbol).join(' ')}`,
		schema: {
			type: 'object',
			properties: {
				items: {
					type: 'array',
					items: {
						type: 'object',
						properties: { symbol: { type: 'string' }, name_es: { type: 'string' } },
						required: ['symbol', 'name_es']
					}
				}
			},
			required: ['items']
		},
		temperature: 0.3
	});
	for (const it of res.items) {
		if (!it.name_es?.trim()) continue;
		db.update(s.component)
			.set({ nameEs: it.name_es.trim(), nameSource: 'gemini' })
			.where(eq(s.component.symbol, it.symbol))
			.run();
	}
}

/** Componentes por llamada al generar explicaciones (cada uno lleva su lista de kanji de ejemplo). */
const EXPLAIN_CHUNK = 10;

/**
 * Explicación de cada componente para su lección: qué dibuja, por qué el nombre, su papel y ejemplos razonados
 * (solo entre los kanji donde aparece de verdad). Salta los que ya la tienen.
 */
export async function ensureComponentExplanations(db: DB, symbols: string[]) {
	if (!hasGemini() || !symbols.length) return;
	const missing = db
		.select({ symbol: s.component.symbol, name: s.component.nameEs })
		.from(s.component)
		.where(and(inArray(s.component.symbol, symbols), isNull(s.component.explanation)))
		.orderBy(s.component.learnOrder, s.component.symbol)
		.all();
	for (let i = 0; i < missing.length; i += EXPLAIN_CHUNK) {
		const part = missing.slice(i, i + EXPLAIN_CHUNK);
		const used = new Map<string, Set<string>>();
		const desc = part
			.map((c) => {
				const info = getComponentInfo(db, c.symbol);
				const ex = info?.examples ?? [];
				used.set(c.symbol, new Set(ex.map((e) => e.char)));
				const exText = ex.map((e) => `${e.char}${e.meaning ? ` «${e.meaning}»` : ''}`).join(', ');
				const full = info?.fullForm ? `; variante de ${info.fullForm.char}${info.fullForm.meaning ? ` «${info.fullForm.meaning}»` : ''}` : '';
				return `- ${c.symbol}: nombre «${c.name ?? '—'}»${full}; aparece en: ${exText || '—'}`;
			})
			.join('\n');
		const res = await generateJson<{ items: (ComponentExplanation & { symbol: string })[] }>({
			db,
			feature: 'component_explain',
			model: models(db).pro,
			system: SYSTEM,
			contents:
				'Explica estos componentes de kanji a un principiante que aprende a LEER. Para cada uno:\n' +
				'- "depicts": qué dibuja y de dónde viene (pictograma, forma reducida de otro kanji…), 1-2 frases. Si el origen es dudoso, descríbelo por su forma y dilo; no inventes etimologías.\n' +
				'- "why": por qué el nombre dado tiene sentido (relaciona la forma con el nombre), 1 frase.\n' +
				'- "role": qué aporta en los kanji donde aparece: pista de significado, de sonido o solo de forma, y dónde suele ir (izquierda, arriba…), 1-2 frases.\n' +
				'- "examples": 2-3 kanji ELEGIDOS SOLO de su lista «aparece en», los más claros, con "note" (1 frase) que muestre cómo el componente encaja con el significado del kanji. Si en uno solo aporta forma, dilo.\n' +
				'- "hook": una imagen corta y visual para usar el componente en mnemotecnias (máx. 15 palabras).\n' +
				'Usa el nombre en español dado, sin cambiarlo. Nada de romaji.\n' +
				desc,
			schema: {
				type: 'object',
				properties: {
					items: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								symbol: { type: 'string' },
								depicts: { type: 'string' },
								why: { type: 'string' },
								role: { type: 'string' },
								examples: {
									type: 'array',
									items: {
										type: 'object',
										properties: { char: { type: 'string' }, note: { type: 'string' } },
										required: ['char', 'note']
									}
								},
								hook: { type: 'string' }
							},
							required: ['symbol', 'depicts', 'why', 'role', 'examples', 'hook']
						}
					}
				},
				required: ['items']
			},
			temperature: 0.4
		});
		for (const it of res.items) {
			const allowed = used.get(it.symbol);
			if (!allowed || !it.depicts?.trim()) continue;
			const explanation: ComponentExplanation = {
				depicts: it.depicts.trim(),
				why: it.why.trim(),
				role: it.role.trim(),
				// Solo ejemplos donde el componente aparece de verdad.
				examples: (it.examples ?? []).filter((e) => allowed.has(e.char) && e.note?.trim()).slice(0, 3),
				hook: it.hook.trim()
			};
			db.update(s.component)
				.set({ explanation, explanationSource: 'gemini' })
				.where(eq(s.component.symbol, it.symbol))
				.run();
		}
	}
}

export async function ensureMnemonics(db: DB, chars: string[]) {
	if (!hasGemini() || !chars.length) return;
	const rows = db
		.select()
		.from(s.kanji)
		.where(and(inArray(s.kanji.char, chars), isNull(s.kanji.mnemonicMeaning)))
		.all();
	if (!rows.length) return;
	const parts = db
		.select({ kanji: s.kanjiComponent.kanji, symbol: s.kanjiComponent.symbol, name: s.component.nameEs })
		.from(s.kanjiComponent)
		.leftJoin(s.component, eq(s.component.symbol, s.kanjiComponent.symbol))
		.where(inArray(s.kanjiComponent.kanji, rows.map((r) => r.char)))
		.all();
	const desc = rows
		.map((k) => {
			const comps = parts
				.filter((p) => p.kanji === k.char)
				.map((p) => `${p.symbol}${p.name ? ` (${p.name})` : ''}`)
				.join(' + ');
			const meaning = (k.meaningsEs.length ? k.meaningsEs : k.meaningsEn).slice(0, 3).join('; ');
			return `- ${k.char}: significado «${meaning}»; on: ${k.onReadings.join('、') || '—'}; kun: ${k.kunReadings.join('、') || '—'}; componentes: ${comps || 'ninguno'}`;
		})
		.join('\n');
	const res = await generateJson<{ items: { char: string; meaning: string; reading: string }[] }>({
		db,
		feature: 'mnemonic',
		model: models(db).pro,
		system: SYSTEM,
		contents:
			'Crea mnemotecnias en español para estos kanji.\n' +
			'- "meaning": 1-3 frases que combinen los NOMBRES de los componentes en una escena visual que lleve al significado principal. Resalta el significado en **negrita**.\n' +
			'- "reading": 1-2 frases que ayuden a recordar la lectura más útil (indica cuál, en kana), con un juego de sonido en español.\n' +
			desc,
		schema: {
			type: 'object',
			properties: {
				items: {
					type: 'array',
					items: {
						type: 'object',
						properties: { char: { type: 'string' }, meaning: { type: 'string' }, reading: { type: 'string' } },
						required: ['char', 'meaning', 'reading']
					}
				}
			},
			required: ['items']
		},
		temperature: 0.8
	});
	for (const it of res.items) {
		db.update(s.kanji)
			.set({ mnemonicMeaning: it.meaning, mnemonicReading: it.reading, mnemonicSource: 'gemini' })
			.where(eq(s.kanji.char, it.char))
			.run();
	}
}

/** Consejos breves para distinguir pares de kanji parecidos (se cachean en similar_kanji.tip). */
export async function ensureSimilarTips(db: DB, pairs: { a: string; b: string }[]) {
	if (!hasGemini() || !pairs.length) return;
	const norm = [...new Map(pairs.map((p) => (p.a < p.b ? [p.a + p.b, p] : [p.b + p.a, { a: p.b, b: p.a }]))).values()];
	const missing = norm.filter(
		(p) =>
			!db
				.select({ t: s.similarKanji.tip })
				.from(s.similarKanji)
				.where(and(eq(s.similarKanji.a, p.a), eq(s.similarKanji.b, p.b)))
				.get()?.t
	);
	if (!missing.length) return;
	const info = (c: string) => {
		const k = db.select().from(s.kanji).where(eq(s.kanji.char, c)).get();
		return `${c} «${(k?.meaningsEs.length ? k.meaningsEs : (k?.meaningsEn ?? [])).slice(0, 2).join('; ')}»`;
	};
	const res = await generateJson<{ items: { a: string; b: string; tip: string }[] }>({
		db,
		feature: 'similar_tips',
		model: models(db).flash,
		system: SYSTEM,
		contents:
			'Para cada par de kanji que se parecen, escribe UNA frase en español que explique la diferencia visual clave y la asocie al significado (p. ej. «末 tiene la raya de arriba más larga: el final del árbol»).\n' +
			missing.map((p) => `- ${info(p.a)} / ${info(p.b)}`).join('\n'),
		schema: {
			type: 'object',
			properties: {
				items: {
					type: 'array',
					items: {
						type: 'object',
						properties: { a: { type: 'string' }, b: { type: 'string' }, tip: { type: 'string' } },
						required: ['a', 'b', 'tip']
					}
				}
			},
			required: ['items']
		},
		temperature: 0.4
	});
	for (const it of res.items) {
		const [a, b] = it.a < it.b ? [it.a, it.b] : [it.b, it.a];
		db.update(s.similarKanji)
			.set({ tip: it.tip, tipSource: 'gemini' })
			.where(and(eq(s.similarKanji.a, a), eq(s.similarKanji.b, b)))
			.run();
	}
}

/**
 * Mnemotecnia NUEVA para un kanji que se resiste (sanguijuela): distinta de la anterior y,
 * si hay notas del alumno (intereses), apoyada en ellas.
 */
export async function regenerateMnemonic(db: DB, char: string, interests: string[]) {
	const k = db.select().from(s.kanji).where(eq(s.kanji.char, char)).get();
	if (!k) throw new Error('Kanji no encontrado');
	const comps = db
		.select({ symbol: s.kanjiComponent.symbol, name: s.component.nameEs })
		.from(s.kanjiComponent)
		.leftJoin(s.component, eq(s.component.symbol, s.kanjiComponent.symbol))
		.where(eq(s.kanjiComponent.kanji, char))
		.all();
	const res = await generateJson<{ meaning: string; reading: string }>({
		db,
		feature: 'leech_mnemonic',
		model: models(db).pro,
		system: SYSTEM,
		contents:
			`El alumno falla una y otra vez el kanji ${char} («${(k.meaningsEs.length ? k.meaningsEs : k.meaningsEn).slice(0, 3).join('; ')}», on: ${k.onReadings.join('、') || '—'}, kun: ${k.kunReadings.join('、') || '—'}).\n` +
			`Componentes: ${comps.map((c) => `${c.symbol}${c.name ? ` (${c.name})` : ''}`).join(' + ') || 'ninguno'}.\n` +
			`Mnemotecnia anterior (NO sirvió, haz otra muy distinta, más visual y exagerada): ${k.mnemonicMeaning ?? '—'}\n` +
			(interests.length ? `Intereses del alumno, úsalos si encajan: ${interests.join('; ')}\n` : '') +
			'Devuelve "meaning" (1-3 frases, significado en **negrita**) y "reading" (1-2 frases para la lectura más útil, indícala en kana).',
		schema: {
			type: 'object',
			properties: { meaning: { type: 'string' }, reading: { type: 'string' } },
			required: ['meaning', 'reading']
		},
		temperature: 1
	});
	// Hecha a medida (intereses y notas del alumno): `personal` para no publicarla nunca como contenido pregenerado.
	db.update(s.kanji)
		.set({ mnemonicMeaning: res.meaning, mnemonicReading: res.reading, mnemonicSource: 'personal' })
		.where(eq(s.kanji.char, char))
		.run();
	return res;
}

export async function ensureGlossesEs(db: DB, vocabIds: string[]) {
	if (!hasGemini() || !vocabIds.length) return;
	const rows = db
		.select()
		.from(s.vocab)
		.where(and(inArray(s.vocab.id, vocabIds), isNull(s.vocab.glossesEs)))
		.all();
	if (!rows.length) return;
	const res = await generateJson<{ items: { id: string; glosses: string[] }[] }>({
		db,
		feature: 'glosses',
		model: models(db).flash,
		system: SYSTEM,
		contents:
			'Traduce al español las acepciones (glosas en inglés) de estas palabras japonesas. ' +
			'Devuelve 1-4 glosas cortas por palabra, la más común primero.\n' +
			rows.map((r) => `- id=${r.id} ${r.mainForm}【${r.mainReading}】: ${r.glossesEn.join('; ')}`).join('\n'),
		schema: {
			type: 'object',
			properties: {
				items: {
					type: 'array',
					items: {
						type: 'object',
						properties: { id: { type: 'string' }, glosses: { type: 'array', items: { type: 'string' } } },
						required: ['id', 'glosses']
					}
				}
			},
			required: ['items']
		},
		temperature: 0.2
	});
	for (const it of res.items) {
		if (!it.glosses?.length) continue;
		db.update(s.vocab).set({ glossesEs: it.glosses, glossesEsSource: 'gemini' }).where(eq(s.vocab.id, it.id)).run();
	}
}

export async function ensureSentencesEs(db: DB, vocabIds: string[]) {
	if (!hasGemini() || !vocabIds.length) return;
	const rows = db
		.select()
		.from(s.sentence)
		.where(and(inArray(s.sentence.vocabId, vocabIds), isNull(s.sentence.es)))
		.limit(40)
		.all();
	if (!rows.length) return;
	const res = await generateJson<{ items: { id: number; es: string }[] }>({
		db,
		feature: 'sentences',
		model: models(db).flash,
		system: SYSTEM,
		contents:
			'Traduce al español natural estas frases japonesas (usa la traducción inglesa solo como apoyo).\n' +
			rows.map((r) => `- id=${r.id}: ${r.jp} (EN: ${r.en ?? '—'})`).join('\n'),
		schema: {
			type: 'object',
			properties: {
				items: {
					type: 'array',
					items: {
						type: 'object',
						properties: { id: { type: 'integer' }, es: { type: 'string' } },
						required: ['id', 'es']
					}
				}
			},
			required: ['items']
		},
		temperature: 0.2
	});
	for (const it of res.items) db.update(s.sentence).set({ es: it.es, esSource: 'gemini' }).where(eq(s.sentence.id, it.id)).run();
}
