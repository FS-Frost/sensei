// SVG de KanjiVG por kanji (lo sirve el Worker desde la caché `sensei-kanjivg`). Una petición por kanji y página.
const cache = new Map<string, Promise<string | null>>();

export function kanjiSvg(ch: string): Promise<string | null> {
	let p = cache.get(ch);
	if (!p) {
		p = fetch(`/api/kanjivg/${encodeURIComponent(ch)}`)
			.then((r) => (r.ok ? r.text() : null))
			.catch(() => null);
		cache.set(ch, p);
		// Sin red no se guarda el fallo: al volver la conexión se reintenta.
		void p.then((x) => x === null && cache.delete(ch));
	}
	return p;
}
