// Kanji visualmente parecidos: se calculan al importar para PREVENIR confusiones (avisar al aprender el segundo).

/** Pares clásicos que no siempre comparten componentes en KRADFILE. */
export const CURATED_PAIRS: [string, string][] = [
	['未', '末'], ['土', '士'], ['人', '入'], ['大', '犬'], ['大', '太'], ['千', '干'], ['日', '曰'], ['王', '玉'],
	['王', '主'], ['刀', '力'], ['牛', '午'], ['待', '持'], ['待', '特'], ['持', '特'], ['間', '問'], ['問', '聞'],
	['己', '已'], ['矢', '失'], ['天', '夫'], ['右', '石'], ['白', '百'], ['目', '自'], ['田', '由'], ['田', '申'],
	['由', '申'], ['休', '体'], ['未', '味'], ['住', '往'], ['怒', '努'], ['識', '織'], ['職', '識'], ['貝', '見'],
	['券', '巻'], ['宇', '字'], ['鳥', '島'], ['鳥', '烏'], ['末', '本'], ['木', '本'], ['折', '析'], ['候', '侯'],
	['壊', '懐'], ['輸', '輪'], ['論', '輪'], ['績', '積'], ['責', '貴'], ['延', '廷'], ['微', '徴'], ['崎', '埼'],
	['借', '惜'], ['暑', '署'], ['講', '構'], ['講', '購'], ['複', '復'], ['腹', '複'], ['険', '検'], ['険', '験'],
	['検', '験'], ['祖', '組'], ['粗', '組'], ['低', '底'], ['抵', '低'], ['思', '恩'], ['今', '令'], ['冷', '令'],
	['困', '因'], ['洋', '注'], ['陸', '睦'], ['義', '議'], ['義', '儀'], ['兄', '見'], ['氷', '永'], ['水', '氷'], ['午', '干'],
	['工', '土'], ['刃', '刀'], ['斤', '片'], ['戸', '声'], ['北', '比'], ['未', '朱'], ['読', '続'], ['間', '聞'],
	['話', '語'], ['語', '読'], ['持', '時'], ['晴', '清'], ['晴', '情'], ['清', '情'], ['青', '責'], ['使', '便'],
	['達', '違'], ['決', '快'], ['形', '刑'], ['帰', '掃'], ['副', '福'], ['福', '幅'], ['幸', '辛'], ['鳴', '鳩'],
	['姉', '妹'], ['弟', '第'], ['早', '旱'], ['市', '布'], ['易', '昜'], ['場', '湯'], ['陽', '場'], ['悪', '亜']
];

type KanjiIn = { char: string; strokes: number | null };

/**
 * Para cada kanji, hasta `perKanji` parecidos. Puntuación = Jaccard de componentes − penalización por trazos.
 * Los pares curados entran siempre con puntuación 1.
 */
export function computeSimilar(kanji: KanjiIn[], decomposition: Map<string, string[]>, perKanji = 4) {
	const strokes = new Map(kanji.map((k) => [k.char, k.strokes ?? 0]));
	const sets = new Map<string, Set<string>>();
	for (const k of kanji) sets.set(k.char, new Set(decomposition.get(k.char) ?? []));
	const byComp = new Map<string, string[]>();
	for (const [k, comps] of sets) for (const c of comps) byComp.set(c, [...(byComp.get(c) ?? []), k]);

	const pairs = new Map<string, number>();
	const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

	for (const [k, comps] of sets) {
		if (comps.size < 2) continue;
		const cand = new Map<string, number>();
		for (const c of comps) {
			const users = byComp.get(c) ?? [];
			// Componentes muy comunes (口, 一…) no discriminan: ignorarlos si aparecen en cientos de kanji.
			if (users.length > 250) continue;
			for (const o of users) if (o !== k) cand.set(o, (cand.get(o) ?? 0) + 1);
		}
		const scored: [string, number][] = [];
		for (const [o, shared] of cand) {
			const other = sets.get(o)!;
			const jac = shared / (comps.size + other.size - shared);
			const dStroke = Math.abs((strokes.get(k) ?? 0) - (strokes.get(o) ?? 0));
			if (jac < 0.5 || dStroke > 3) continue;
			scored.push([o, jac - 0.05 * dStroke]);
		}
		scored.sort((a, b) => b[1] - a[1]);
		for (const [o, sc] of scored.slice(0, perKanji)) {
			const kk = key(k, o);
			pairs.set(kk, Math.max(pairs.get(kk) ?? 0, sc));
		}
	}
	for (const [a, b] of CURATED_PAIRS) if (strokes.has(a) && strokes.has(b)) pairs.set(key(a, b), 1);
	return [...pairs].map(([k, score]) => {
		const [a, b] = k.split('|');
		return { a, b, score: Math.round(score * 100) / 100 };
	});
}
