// Frases minadas: tarjetas en contexto («この{生|なま}ビール…» → lectura de 生). El contexto desambigua lecturas.
import { eq, sql } from 'drizzle-orm';
import type { DB } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { analyzeText } from './analyze.ts';
import { lookupInflected, knownKanji } from '../items.ts';
import { ensureCard } from '../srs/service.ts';
import { hasKanji, kanjiIn, toHiragana } from '../../jp.ts';

export class MiningError extends Error {}

export function mineSentence(
	db: DB,
	input: { jp: string; es?: string | null; target: string; targetReading?: string | null; vocabId?: string | null; source: string }
) {
	const jp = input.jp.trim().slice(0, 300);
	const target = input.target.trim();
	if (!jp || !target) throw new MiningError('Faltan la frase o la palabra');
	if (!jp.includes(target)) throw new MiningError('La palabra no aparece en la frase');
	let reading = input.targetReading?.trim() || null;
	let vocabId = input.vocabId ?? null;
	if (!reading || !vocabId) {
		const tok = analyzeText(db, jp).tokens.find((t) => t.s === target);
		reading ||= tok?.r ?? null;
		vocabId ||= tok?.id ?? null;
		if (!vocabId) vocabId = lookupInflected(db, target, 1)[0]?.id ?? null;
	}
	if (!reading && !hasKanji(target)) reading = toHiragana(target);
	if (!reading) throw new MiningError('No sé la lectura de esa palabra: indícala');
	const row = db
		.insert(s.minedSentence)
		.values({
			jp,
			es: input.es?.trim() || null,
			target,
			targetReading: toHiragana(reading),
			vocabId,
			source: input.source,
			createdAt: Date.now()
		})
		.returning()
		.get();
	ensureCard(db, 'sentence', String(row.id), 'reading');
	return row;
}

export function deleteMined(db: DB, id: number) {
	db.run(sql`delete from card where item_type = 'sentence' and item_key = ${String(id)}`);
	db.run(sql`delete from review_log where item_type = 'sentence' and item_key = ${String(id)}`);
	db.delete(s.minedSentence).where(eq(s.minedSentence.id, id)).run();
}

/**
 * Texto para el reto de velocidad SIN IA: frases de Tatoeba cuyos kanji ya conoces, hasta ~`targetChars` caracteres.
 * Devuelve null si aún no hay suficientes frases a tu nivel.
 */
export function offlineSpeedText(db: DB, targetChars = 300): { sentences: { jp: string; es: string | null }[] } | null {
	const known = new Set(knownKanji(db));
	if (known.size < 15) return null;
	const rows = db.all<{ jp: string; es: string | null; en: string | null }>(sql`
		select jp, es, en from sentence where length(jp) between 8 and 40 order by random() limit 3000
	`);
	const picked: { jp: string; es: string | null }[] = [];
	let chars = 0;
	for (const r of rows) {
		const ks = kanjiIn(r.jp);
		if (!ks.length || !ks.every((k) => known.has(k))) continue;
		picked.push({ jp: r.jp, es: r.es ?? r.en });
		chars += r.jp.length;
		if (chars >= targetChars) break;
	}
	return chars >= targetChars * 0.5 ? { sentences: picked } : null;
}
