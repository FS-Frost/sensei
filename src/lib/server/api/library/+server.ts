import type { RequestHandler } from '#lib/server/router.ts';
import { desc } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as s from '#lib/server/db/schema.ts';
import { handle, HttpError } from '#lib/server/http.ts';
import { addTexts, epubToChapters, htmlToText, nextRereadAt, readsOf, srtToText } from '#lib/server/text/library.ts';

const MAX_FILE = 30 * 1024 * 1024;

export const GET: RequestHandler = () =>
	handle(() => {
		const rows = db
			.select({ id: s.libraryText.id, title: s.libraryText.title, origin: s.libraryText.origin, createdAt: s.libraryText.createdAt, chars: s.libraryText.content })
			.from(s.libraryText)
			.orderBy(desc(s.libraryText.createdAt))
			.all();
		return Response.json({
			texts: rows.map((r) => {
				const reads = readsOf(db, 'library', r.id);
				return {
					id: r.id,
					title: r.title,
					origin: r.origin,
					createdAt: r.createdAt,
					chars: r.chars.length,
					reads: reads.length,
					lastCpm: reads.at(-1)?.cpm ?? null,
					nextReread: nextRereadAt(reads)
				};
			})
		});
	});

/**
 * Formulario: `title` + `text` (pegado) o `file` (.txt, .srt, .epub, .html).
 * Los EPUB se dividen en capítulos (un texto por capítulo).
 */
export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		const form = await request.formData().catch(() => {
			throw new HttpError(400, 'Formulario inválido');
		});
		const title = String(form.get('title') ?? '').trim();
		const pasted = String(form.get('text') ?? '').trim();
		const file = form.get('file');
		let items: { title: string; text: string }[] = [];
		let origin = 'paste';
		if (file instanceof File && file.size) {
			if (file.size > MAX_FILE) throw new HttpError(413, 'Archivo demasiado grande (máx. 30 MB)');
			const name = file.name.toLowerCase();
			const base = title || file.name.replace(/\.[^.]+$/, '');
			if (name.endsWith('.epub')) {
				origin = 'epub';
				let chapters;
				try {
					chapters = epubToChapters(new Uint8Array(await file.arrayBuffer()));
				} catch {
					throw new HttpError(400, 'No se pudo leer el EPUB');
				}
				if (!chapters.length) throw new HttpError(400, 'El EPUB no tiene texto legible');
				items = chapters.map((c, i) => ({ title: `${base} · ${c.title || `cap. ${i + 1}`}`, text: c.text }));
			} else {
				const raw = await file.text();
				origin = name.endsWith('.srt') ? 'srt' : name.match(/\.x?html?$/) ? 'html' : 'txt';
				const text = origin === 'srt' ? srtToText(raw) : origin === 'html' ? htmlToText(raw) : raw;
				items = [{ title: base, text }];
			}
		} else if (pasted) {
			items = [{ title: title || pasted.slice(0, 24).replace(/\s+/g, ' ') + '…', text: pasted }];
		} else throw new HttpError(400, 'Pega un texto o elige un archivo');
		items = items.filter((i) => i.text.trim());
		if (!items.length) throw new HttpError(400, 'No se encontró texto');
		return Response.json({ ids: addTexts(db, items, origin) });
	});
