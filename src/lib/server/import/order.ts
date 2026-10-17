export type OrderInput = { char: string; freq: number | null; grade: number | null; strokes: number | null };

/**
 * Orden de aprendizaje "componentes + frecuencia".
 *
 * Recorre los kanji por frecuencia; antes de cada kanji coloca sus componentes.
 * Si un componente es a su vez un kanji incluido, se enseña ese kanji (recursivamente) en vez del componente.
 * Kanji y componentes comparten una única secuencia, así las lecciones siguen un solo orden.
 */
export function computeLearnOrder(
	kanji: OrderInput[],
	decomposition: Map<string, string[]>,
	componentStrokes: (sym: string) => number
) {
	const byChar = new Map(kanji.map((k) => [k.char, k]));
	const priority = (k: OrderInput) => k.freq ?? 3000 + (k.grade ?? 9) * 100 + (k.strokes ?? 30);
	const sorted = [...kanji].sort((a, b) => priority(a) - priority(b) || a.char.localeCompare(b.char));

	const kanjiOrder = new Map<string, number>();
	const componentOrder = new Map<string, number>();
	const visiting = new Set<string>();
	let seq = 0;

	const placeKanji = (ch: string) => {
		if (kanjiOrder.has(ch) || visiting.has(ch)) return;
		visiting.add(ch);
		const comps = [...(decomposition.get(ch) ?? [])].sort((a, b) => componentStrokes(a) - componentStrokes(b));
		for (const c of comps) {
			if (byChar.has(c)) placeKanji(c);
			else if (!componentOrder.has(c)) componentOrder.set(c, seq++);
		}
		visiting.delete(ch);
		kanjiOrder.set(ch, seq++);
	};

	for (const k of sorted) placeKanji(k.char);
	return { kanji: kanjiOrder, components: componentOrder };
}
