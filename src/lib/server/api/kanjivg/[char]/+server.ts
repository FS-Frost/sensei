import type { RequestHandler } from '#lib/server/router.ts';
import { isKanjiChar } from '#lib/jp.ts';

const BASE = 'https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg@master/kanji';
const CACHE = 'sensei-kanjivg';

/** Orden de trazos (KanjiVG, CC-BY-SA). Se descarga una vez y se guarda en la Cache API del navegador. */
export const GET: RequestHandler = async ({ params }) => {
	const ch = params.char;
	// Kanji y kana (KanjiVG trae también hiragana y katakana, con dakuten).
	if ([...ch].length !== 1 || !(isKanjiChar(ch) || /^[ぁ-ゖァ-ヺ]$/.test(ch))) return new Response('Carácter inválido', { status: 400 });
	const hex = ch.codePointAt(0)!.toString(16).padStart(5, '0');
	const url = `${BASE}/${hex}.svg`;
	const cache = typeof caches !== 'undefined' ? await caches.open(CACHE) : null;
	let res = await cache?.match(url);
	if (!res) {
		const fresh = await fetch(url);
		if (!fresh.ok) return new Response('Sin datos de trazos', { status: 404 });
		await cache?.put(url, fresh.clone());
		res = fresh;
	}
	return new Response(await res.text(), {
		headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' }
	});
};
