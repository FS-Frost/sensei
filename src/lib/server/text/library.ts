// Biblioteca de textos reales: importación (pegado, .txt, .srt, .epub), relectura espaciada y velocidad.
import { strFromU8, unzipSync } from 'fflate';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/index.ts';
import * as s from '../db/schema.ts';

export const MAX_TEXT_CHARS = 40_000;
const MAX_CHAPTERS = 40;

/** Intervalos de relectura (días) tras la 1.ª, 2.ª, 3.ª… lectura. Releer mejora la fluidez más que leer siempre algo nuevo. */
export const REREAD_DAYS = [1, 3, 7, 21, 60];

function decodeEntities(s: string) {
	return s
		.replace(/&nbsp;/g, ' ')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&amp;/g, '&');
}

/** HTML/XHTML → texto. Quita la furigana del original (<rt>/<rp>): la pone Sensei según tu nivel. */
export function htmlToText(html: string) {
	return decodeEntities(
		html
			.replace(/<head[\s\S]*?<\/head>/gi, '')
			.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
			.replace(/<rt[\s\S]*?<\/rt>|<rp[\s\S]*?<\/rp>/gi, '')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/(p|div|h\d|li|tr)>/gi, '\n')
			.replace(/<[^>]+>/g, '')
	)
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** Subtítulos .srt → solo el diálogo. */
export function srtToText(srt: string) {
	return srt
		.replace(/\r/g, '')
		.split('\n')
		.filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l))
		.map((l) => l.replace(/<[^>]+>/g, '').trim())
		.join('\n');
}

/** EPUB → capítulos en orden de lectura (spine del OPF). */
export function epubToChapters(bytes: Uint8Array): { title: string; text: string }[] {
	const files = unzipSync(bytes);
	const get = (p: string) => (files[p] ? strFromU8(files[p]) : null);
	const container = get('META-INF/container.xml');
	const opfPath = container?.match(/full-path="([^"]+)"/)?.[1];
	const opf = opfPath ? get(opfPath) : null;
	if (!opfPath || !opf) throw new Error('EPUB sin OPF');
	const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
	const manifest = new Map<string, string>();
	for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
		const id = m[0].match(/\bid="([^"]+)"/)?.[1];
		const href = m[0].match(/\bhref="([^"]+)"/)?.[1];
		if (id && href) manifest.set(id, decodeURIComponent(href));
	}
	const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)].map((m) => m[1]);
	const out: { title: string; text: string }[] = [];
	for (const id of spine) {
		const href = manifest.get(id);
		if (!href) continue;
		const html = get(base + href);
		if (!html) continue;
		const text = htmlToText(html);
		if (text.replace(/\s/g, '').length < 30) continue; // portadas, índices vacíos
		const title = htmlToText(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '') || `Capítulo ${out.length + 1}`;
		out.push({ title, text });
		if (out.length >= MAX_CHAPTERS) break;
	}
	return out;
}

/** Trocea un texto largo por párrafos en partes de ≤ MAX_TEXT_CHARS. */
export function splitLong(text: string, max = MAX_TEXT_CHARS): string[] {
	if (text.length <= max) return [text];
	const parts: string[] = [];
	let cur = '';
	for (const p of text.split('\n')) {
		if (cur.length + p.length + 1 > max && cur) {
			parts.push(cur);
			cur = '';
		}
		cur += (cur ? '\n' : '') + p.slice(0, max);
	}
	if (cur) parts.push(cur);
	return parts;
}

export function addTexts(db: DB, items: { title: string; text: string }[], origin: string) {
	const now = Date.now();
	const ids: number[] = [];
	for (const it of items) {
		const chunks = splitLong(it.text);
		chunks.forEach((c, i) => {
			const title = chunks.length > 1 ? `${it.title} (${i + 1}/${chunks.length})` : it.title;
			ids.push(
				db
					.insert(s.libraryText)
					.values({ title: title.slice(0, 200), content: c, origin, createdAt: now })
					.returning({ id: s.libraryText.id })
					.get().id
			);
		});
	}
	return ids;
}

// ---------- Lecturas: registro, relectura y velocidad ----------

export type TextKind = 'graded' | 'library' | 'speed';

export function logReading(
	db: DB,
	r: { textKind: TextKind; textId: number; chars: number; durationMs: number; furigana: string; comprehension?: number | null }
) {
	const minutes = Math.max(r.durationMs, 1000) / 60_000;
	const cpm = Math.round((r.chars / minutes) * 10) / 10;
	return db
		.insert(s.readingLog)
		.values({ ...r, comprehension: r.comprehension ?? null, cpm, createdAt: Date.now() })
		.returning()
		.get();
}

export function readsOf(db: DB, textKind: TextKind, textId: number) {
	return db
		.select()
		.from(s.readingLog)
		.where(and(eq(s.readingLog.textKind, textKind), eq(s.readingLog.textId, textId)))
		.orderBy(s.readingLog.createdAt)
		.all();
}

export function nextRereadAt(reads: { createdAt: number }[]): number | null {
	if (!reads.length) return null;
	const last = reads[reads.length - 1].createdAt;
	const days = REREAD_DAYS[Math.min(reads.length - 1, REREAD_DAYS.length - 1)];
	return last + days * 86_400_000;
}

export type RereadDue = { textKind: TextKind; textId: number; title: string; reads: number; lastCpm: number; dueAt: number };

/** Textos (biblioteca y lecturas graduadas) cuya relectura toca ya. */
export function rereadsDue(db: DB, now = Date.now()): RereadDue[] {
	const rows = db.all<{ k: TextKind; id: number; n: number; last: number; cpm: number }>(sql`
		select text_kind as k, text_id as id, count(*) as n, max(created_at) as last,
			(select cpm from reading_log r2 where r2.text_kind = reading_log.text_kind and r2.text_id = reading_log.text_id
			 order by created_at desc limit 1) as cpm
		from reading_log where text_kind in ('graded', 'library') group by text_kind, text_id
	`);
	const out: RereadDue[] = [];
	for (const r of rows) {
		const dueAt = r.last + REREAD_DAYS[Math.min(r.n - 1, REREAD_DAYS.length - 1)] * 86_400_000;
		if (dueAt > now) continue;
		const title =
			r.k === 'library'
				? db.select({ t: s.libraryText.title }).from(s.libraryText).where(eq(s.libraryText.id, r.id)).get()?.t
				: ((db.select({ c: s.generatedText.content }).from(s.generatedText).where(eq(s.generatedText.id, r.id)).get()?.c as
						| { title?: string }
						| undefined)?.title ?? undefined);
		if (!title) continue; // texto borrado
		out.push({ textKind: r.k, textId: r.id, title, reads: r.n, lastCpm: r.cpm, dueAt });
	}
	return out.sort((a, b) => a.dueAt - b.dueAt);
}

/** Historial de velocidad (todas las lecturas cronometradas). */
export function speedHistory(db: DB, limit = 60) {
	return db.select().from(s.readingLog).orderBy(desc(s.readingLog.createdAt)).limit(limit).all().reverse();
}
