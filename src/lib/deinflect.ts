// Deconjugador basado en reglas (estilo Yomichan): forma conjugada → candidatos a forma de diccionario.
// Los candidatos se validan después contra JMdict (existencia + categoría gramatical compatible).

export const T = {
	V1: 1, // ichidan (食べる)
	V5: 2, // godan (書く)
	VK: 4, // 来る
	VS: 8, // する
	ADJ_I: 16, // 高い
	MASU: 32, // forma ます (intermedia)
	TE: 64, // forma て (intermedia)
	TA: 128 // forma た (intermedia)
} as const;

const DICT_TYPES = T.V1 | T.V5 | T.VK | T.VS | T.ADJ_I;

type Rule = { from: string; to: string; inTypes: number; outTypes: number; reason: string };

const rules: Rule[] = [];
const add = (from: string, to: string, inTypes: number, outTypes: number, reason: string) =>
	rules.push({ from, to, inTypes, outTypes, reason });

// ---------- Godan ----------
// terminación → [a, i, e, o, te, ta]
const GODAN: Record<string, [string, string, string, string, string, string]> = {
	う: ['わ', 'い', 'え', 'お', 'って', 'った'],
	く: ['か', 'き', 'け', 'こ', 'いて', 'いた'],
	ぐ: ['が', 'ぎ', 'げ', 'ご', 'いで', 'いだ'],
	す: ['さ', 'し', 'せ', 'そ', 'して', 'した'],
	つ: ['た', 'ち', 'て', 'と', 'って', 'った'],
	ぬ: ['な', 'に', 'ね', 'の', 'んで', 'んだ'],
	ぶ: ['ば', 'び', 'べ', 'ぼ', 'んで', 'んだ'],
	む: ['ま', 'み', 'め', 'も', 'んで', 'んだ'],
	る: ['ら', 'り', 'れ', 'ろ', 'って', 'った']
};

for (const [u, [a, i, e, o, te, ta]] of Object.entries(GODAN)) {
	add(a + 'ない', u, T.ADJ_I, T.V5, 'negativo');
	add(a + 'ず', u, 0, T.V5, 'sin (ず)');
	add(a + 'ずに', u, 0, T.V5, 'sin (ずに)');
	add(a + 'れる', u, T.V1, T.V5, 'pasiva');
	add(a + 'せる', u, T.V1, T.V5, 'causativa');
	add(a + 'せられる', u, T.V1, T.V5, 'causativa-pasiva');
	if (u !== 'す') add(a + 'される', u, T.V1, T.V5, 'causativa-pasiva');
	add(i + 'ます', u, T.MASU, T.V5, 'cortés');
	add(i + 'たい', u, T.ADJ_I, T.V5, 'deseo (たい)');
	add(i + 'ながら', u, 0, T.V5, 'mientras (ながら)');
	add(i + 'そう', u, 0, T.V5, 'aspecto (そう)');
	add(i + 'すぎる', u, T.V1, T.V5, 'exceso (すぎる)');
	add(i + 'やすい', u, T.ADJ_I, T.V5, 'fácil de');
	add(i + 'にくい', u, T.ADJ_I, T.V5, 'difícil de');
	add(e + 'ば', u, 0, T.V5, 'condicional (ば)');
	add(e + 'る', u, T.V1, T.V5, 'potencial');
	add(e, u, 0, T.V5, 'imperativo');
	add(o + 'う', u, 0, T.V5, 'volitiva');
	add(te, u, T.TE, T.V5, 'forma て');
	add(ta, u, T.TA, T.V5, 'pasado');
}
// 行く: て/た irregulares
for (const k of ['行', 'い']) {
	add(k + 'って', k + 'く', T.TE, T.V5, 'forma て');
	add(k + 'った', k + 'く', T.TA, T.V5, 'pasado');
}

// ---------- Ichidan (y 来る escrito con kanji, que conjuga igual en la mayoría de formas) ----------
const ICHI = T.V1 | T.VK;
add('ない', 'る', T.ADJ_I, ICHI, 'negativo');
add('ず', 'る', 0, ICHI, 'sin (ず)');
add('ずに', 'る', 0, ICHI, 'sin (ずに)');
add('ます', 'る', T.MASU, ICHI, 'cortés');
add('て', 'る', T.TE, ICHI, 'forma て');
add('た', 'る', T.TA, ICHI, 'pasado');
add('れば', 'る', 0, ICHI, 'condicional (ば)');
add('られる', 'る', T.V1, ICHI, 'pasiva / potencial');
add('れる', 'る', T.V1, T.V1, 'potencial (coloquial)');
add('させる', 'る', T.V1, ICHI, 'causativa');
add('させられる', 'る', T.V1, ICHI, 'causativa-pasiva');
add('よう', 'る', 0, ICHI, 'volitiva');
add('ろ', 'る', 0, T.V1, 'imperativo');
add('たい', 'る', T.ADJ_I, ICHI, 'deseo (たい)');
add('ながら', 'る', 0, ICHI, 'mientras (ながら)');
add('そう', 'る', 0, ICHI, 'aspecto (そう)');
add('すぎる', 'る', T.V1, ICHI, 'exceso (すぎる)');
add('やすい', 'る', T.ADJ_I, ICHI, 'fácil de');
add('にくい', 'る', T.ADJ_I, ICHI, 'difícil de');

// ---------- する ----------
for (const [from, inT, reason] of [
	['しない', T.ADJ_I, 'negativo'],
	['せず', 0, 'sin (ず)'],
	['します', T.MASU, 'cortés'],
	['して', T.TE, 'forma て'],
	['した', T.TA, 'pasado'],
	['すれば', 0, 'condicional (ば)'],
	['される', T.V1, 'pasiva'],
	['させる', T.V1, 'causativa'],
	['させられる', T.V1, 'causativa-pasiva'],
	['しよう', 0, 'volitiva'],
	['しろ', 0, 'imperativo'],
	['せよ', 0, 'imperativo'],
	['したい', T.ADJ_I, 'deseo (たい)'],
	['しながら', 0, 'mientras (ながら)'],
	['しそう', 0, 'aspecto (そう)'],
	['できる', T.V1, 'potencial']
] as [string, number, string][])
	add(from, 'する', inT, T.VS, reason);

// ---------- くる (en kana) ----------
for (const [from, inT, reason] of [
	['こない', T.ADJ_I, 'negativo'],
	['きます', T.MASU, 'cortés'],
	['きて', T.TE, 'forma て'],
	['きた', T.TA, 'pasado'],
	['くれば', 0, 'condicional (ば)'],
	['こられる', T.V1, 'pasiva / potencial'],
	['こさせる', T.V1, 'causativa'],
	['こよう', 0, 'volitiva'],
	['こい', 0, 'imperativo']
] as [string, number, string][])
	add(from, 'くる', inT, T.VK, reason);

// ---------- Adjetivos -i ----------
add('くない', 'い', T.ADJ_I, T.ADJ_I, 'negativo');
add('かった', 'い', T.TA, T.ADJ_I, 'pasado');
add('くて', 'い', T.TE, T.ADJ_I, 'forma て');
add('く', 'い', 0, T.ADJ_I, 'adverbial (く)');
add('ければ', 'い', 0, T.ADJ_I, 'condicional (ば)');
add('さ', 'い', 0, T.ADJ_I, 'sustantivo (さ)');
add('そう', 'い', 0, T.ADJ_I, 'aspecto (そう)');
add('すぎる', 'い', T.V1, T.ADJ_I, 'exceso (すぎる)');

// ---------- Auxiliares encadenables ----------
add('ました', 'ます', 0, T.MASU, 'pasado');
add('ません', 'ます', 0, T.MASU, 'negativo');
add('ませんでした', 'ます', 0, T.MASU, 'negativo pasado');
add('ましょう', 'ます', 0, T.MASU, 'volitiva');
add('ませんか', 'ます', 0, T.MASU, 'invitación');
add('たら', 'た', 0, T.TA, 'condicional (たら)');
add('だら', 'だ', 0, T.TA, 'condicional (たら)');
add('たり', 'た', 0, T.TA, 'enumeración (たり)');
add('だり', 'だ', 0, T.TA, 'enumeración (たり)');
add('ている', 'て', T.V1, T.TE, 'progresivo (ている)');
add('でいる', 'で', T.V1, T.TE, 'progresivo (ている)');
add('てる', 'て', T.V1, T.TE, 'progresivo (てる)');
add('でる', 'で', T.V1, T.TE, 'progresivo (てる)');
add('ておく', 'て', T.V5, T.TE, 'preparatorio (ておく)');
add('とく', 'て', T.V5, T.TE, 'preparatorio (とく)');
add('てしまう', 'て', T.V5, T.TE, 'completivo (てしまう)');
add('でしまう', 'で', T.V5, T.TE, 'completivo (てしまう)');
add('ちゃう', 'て', T.V5, T.TE, 'completivo (ちゃう)');
add('じゃう', 'で', T.V5, T.TE, 'completivo (ちゃう)');
add('てみる', 'て', T.V1, T.TE, 'intento (てみる)');
add('でみる', 'で', T.V1, T.TE, 'intento (てみる)');
add('てくる', 'て', T.VK, T.TE, 'cambio (てくる)');
add('ていく', 'て', T.V5, T.TE, 'progreso (ていく)');
add('てくれる', 'て', T.V1, T.TE, 'favor (てくれる)');
add('てもらう', 'て', T.V5, T.TE, 'favor (てもらう)');
add('てあげる', 'て', T.V1, T.TE, 'favor (てあげる)');
add('てください', 'て', 0, T.TE, 'petición (てください)');
add('でください', 'で', 0, T.TE, 'petición (てください)');
add('ても', 'て', 0, T.TE, 'concesiva (ても)');
add('でも', 'で', 0, T.TE, 'concesiva (ても)');
add('ては', 'て', 0, T.TE, 'forma ては');
add('ちゃ', 'て', 0, T.TE, 'forma ては (ちゃ)');
add('じゃ', 'で', 0, T.TE, 'forma ては (じゃ)');

// Ordenar por longitud (mejores candidatos primero)
rules.sort((a, b) => b.from.length - a.from.length);

export type Candidate = { term: string; types: number; reasons: string[] };

/** Todas las formas base posibles (incluida la propia palabra sin cambios, con reasons vacío). */
export function deinflect(source: string, maxDepth = 6): Candidate[] {
	const out: Candidate[] = [{ term: source, types: 0, reasons: [] }];
	const seen = new Set<string>([`${source}|0`]);
	for (let i = 0; i < out.length; i++) {
		const { term, types, reasons } = out[i];
		if (reasons.length >= maxDepth) continue;
		for (const r of rules) {
			if (types !== 0 && !(types & r.inTypes)) continue;
			if (!term.endsWith(r.from) || term.length - r.from.length + r.to.length < 1) continue;
			const next = term.slice(0, term.length - r.from.length) + r.to;
			const key = `${next}|${r.outTypes}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push({ term: next, types: r.outTypes, reasons: r.reason ? [r.reason, ...reasons] : reasons });
		}
	}
	// Solo cuentan como resultado las formas de diccionario (o sin cambios).
	return out.filter((c) => c.types === 0 || c.types & DICT_TYPES);
}

/** ¿La categoría JMdict es compatible con los tipos del candidato? */
export function posMatches(pos: string[], types: number): boolean {
	if (types === 0) return true;
	return pos.some(
		(p) =>
			(types & T.V1 && (p === 'v1' || p === 'v1-s')) ||
			(types & T.V5 && p.startsWith('v5')) ||
			(types & T.VK && p === 'vk') ||
			(types & T.VS && (p === 'vs-i' || p === 'vs-s' || p === 'vs')) ||
			(types & T.ADJ_I && (p === 'adj-i' || p === 'adj-ix'))
	);
}
