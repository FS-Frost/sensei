// Escritura de kanji: trazos de KanjiVG (SVG, caja 109×109) y comparación de un trazo dibujado con el esperado.
// Sin IA y sin red (los SVG ya se guardan en la caché `sensei-kanjivg`). Puro: lo usan KanjiTrace.svelte y los tests.

export type Pt = { x: number; y: number };

/** Trazos de un SVG de KanjiVG, en orden (ids `kvg:XXXXX-s1`, `-s2`…). */
export function parseKanjiVG(svg: string): string[] {
	const out: { n: number; d: string }[] = [];
	for (const m of svg.matchAll(/<path\b[^>]*>/g)) {
		const tag = m[0];
		const n = tag.match(/\bid="[^"]*-s(\d+)"/)?.[1];
		const d = tag.match(/\bd="([^"]+)"/)?.[1];
		if (n && d) out.push({ n: Number(n), d });
	}
	return out.sort((a, b) => a.n - b.n).map((x) => x.d);
}

/** Puntos de un path SVG (M, L, H, V, C, S, Q, T, Z; absolutos y relativos), muestreando las curvas. */
export function pathPoints(d: string, perCurve = 12): Pt[] {
	const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
	const pts: Pt[] = [];
	let i = 0;
	let cmd = '';
	let cx = 0;
	let cy = 0;
	let sx = 0;
	let sy = 0;
	let lastCtrl: Pt | null = null;
	const num = () => Number(tokens[i++]);
	const cubic = (p0: Pt, p1: Pt, p2: Pt, p3: Pt) => {
		for (let k = 1; k <= perCurve; k++) {
			const t = k / perCurve;
			const u = 1 - t;
			pts.push({
				x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
				y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
			});
		}
	};
	while (i < tokens.length) {
		if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
		const rel = cmd === cmd.toLowerCase();
		const ox = rel ? cx : 0;
		const oy = rel ? cy : 0;
		switch (cmd.toUpperCase()) {
			case 'M': {
				cx = ox + num();
				cy = oy + num();
				sx = cx;
				sy = cy;
				pts.push({ x: cx, y: cy });
				cmd = rel ? 'l' : 'L'; // pares siguientes = líneas
				lastCtrl = null;
				break;
			}
			case 'L': {
				cx = ox + num();
				cy = oy + num();
				pts.push({ x: cx, y: cy });
				lastCtrl = null;
				break;
			}
			case 'H':
				cx = (rel ? cx : 0) + num();
				pts.push({ x: cx, y: cy });
				lastCtrl = null;
				break;
			case 'V':
				cy = (rel ? cy : 0) + num();
				pts.push({ x: cx, y: cy });
				lastCtrl = null;
				break;
			case 'C': {
				const p1 = { x: ox + num(), y: oy + num() };
				const p2 = { x: ox + num(), y: oy + num() };
				const p3 = { x: ox + num(), y: oy + num() };
				cubic({ x: cx, y: cy }, p1, p2, p3);
				lastCtrl = p2;
				cx = p3.x;
				cy = p3.y;
				break;
			}
			case 'S': {
				const p1 = lastCtrl ? { x: 2 * cx - lastCtrl.x, y: 2 * cy - lastCtrl.y } : { x: cx, y: cy };
				const p2 = { x: ox + num(), y: oy + num() };
				const p3 = { x: ox + num(), y: oy + num() };
				cubic({ x: cx, y: cy }, p1, p2, p3);
				lastCtrl = p2;
				cx = p3.x;
				cy = p3.y;
				break;
			}
			case 'Q':
			case 'T': {
				// Cuadráticas (no las usa KanjiVG, por si acaso): como cúbica equivalente.
				const q: Pt = cmd.toUpperCase() === 'Q' ? { x: ox + num(), y: oy + num() } : lastCtrl ? { x: 2 * cx - lastCtrl.x, y: 2 * cy - lastCtrl.y } : { x: cx, y: cy };
				const p3 = { x: ox + num(), y: oy + num() };
				const p0 = { x: cx, y: cy };
				cubic(p0, { x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y) }, { x: p3.x + (2 / 3) * (q.x - p3.x), y: p3.y + (2 / 3) * (q.y - p3.y) }, p3);
				lastCtrl = q;
				cx = p3.x;
				cy = p3.y;
				break;
			}
			case 'Z':
				cx = sx;
				cy = sy;
				pts.push({ x: cx, y: cy });
				lastCtrl = null;
				break;
			default:
				i++; // comando no soportado: saltar
		}
	}
	return pts;
}

export function length(pts: Pt[]) {
	let l = 0;
	for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
	return l;
}

/** `n` puntos equidistantes a lo largo del trazo. */
export function resample(pts: Pt[], n = 32): Pt[] {
	if (!pts.length) return [];
	if (pts.length === 1) return Array.from({ length: n }, () => ({ ...pts[0] }));
	const total = length(pts);
	if (total === 0) return Array.from({ length: n }, () => ({ ...pts[0] }));
	const stepLen = total / (n - 1);
	const out: Pt[] = [{ ...pts[0] }];
	let acc = 0;
	let prev = pts[0];
	for (let i = 1; i < pts.length && out.length < n; i++) {
		let cur = pts[i];
		let seg = Math.hypot(cur.x - prev.x, cur.y - prev.y);
		while (acc + seg >= stepLen && out.length < n) {
			const t = (stepLen - acc) / seg;
			const p = { x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) };
			out.push(p);
			prev = p;
			seg = Math.hypot(cur.x - prev.x, cur.y - prev.y);
			acc = 0;
		}
		acc += seg;
		prev = cur;
		cur = pts[i];
	}
	while (out.length < n) out.push({ ...pts[pts.length - 1] });
	return out;
}

const meanDist = (a: Pt[], b: Pt[]) => a.reduce((s, p, i) => s + Math.hypot(p.x - b[i].x, p.y - b[i].y), 0) / a.length;

export type StrokeVerdict =
	| { ok: true; score: number }
	| { ok: false; reason: 'direction' | 'shape' | 'position' | 'tiny'; score: number };

/**
 * ¿El trazo dibujado (en coordenadas de la caja 109×109) es el esperado?
 * Tolerancia según la longitud del trazo esperado: los cortos (点) piden menos precisión absoluta.
 */
export function matchStroke(drawn: Pt[], expected: Pt[]): StrokeVerdict {
	const expLen = length(expected);
	const drawnLen = length(drawn);
	if (drawnLen < Math.min(4, expLen * 0.3)) return { ok: false, reason: 'tiny', score: Infinity };
	const a = resample(drawn);
	const b = resample(expected);
	const tol = Math.min(17, Math.max(9, 0.22 * expLen + 6));
	const fwd = meanDist(a, b);
	const rev = meanDist([...a].reverse(), b);
	const startEnd = Math.max(Math.hypot(a[0].x - b[0].x, a[0].y - b[0].y), Math.hypot(a.at(-1)!.x - b.at(-1)!.x, a.at(-1)!.y - b.at(-1)!.y));
	if (fwd <= tol && startEnd <= tol * 1.6) return { ok: true, score: fwd };
	if (rev <= tol && rev < fwd) return { ok: false, reason: 'direction', score: fwd };
	// Forma parecida pero desplazada: comparar centrados.
	const center = (p: Pt[]) => {
		const c = p.reduce((s, q) => ({ x: s.x + q.x / p.length, y: s.y + q.y / p.length }), { x: 0, y: 0 });
		return p.map((q) => ({ x: q.x - c.x, y: q.y - c.y }));
	};
	if (meanDist(center(a), center(b)) <= tol) return { ok: false, reason: 'position', score: fwd };
	return { ok: false, reason: 'shape', score: fwd };
}

/** Índice del trazo (de los que faltan) al que más se parece el dibujado, o -1. Para avisar «ese va después». */
export function bestMatch(drawn: Pt[], candidates: Pt[][]): number {
	let best = -1;
	let bestScore = Infinity;
	candidates.forEach((c, i) => {
		const v = matchStroke(drawn, c);
		if (v.ok && v.score < bestScore) {
			best = i;
			bestScore = v.score;
		}
	});
	return best;
}

/** Calificación del repaso de escritura según los trazos fallados (FSRS: 1 Otra vez · 2 Difícil · 3 Bien). */
export function writingGrade(mistakes: number): { correct: boolean; grade: 1 | 2 | 3 } {
	if (mistakes === 0) return { correct: true, grade: 3 };
	if (mistakes <= 2) return { correct: true, grade: 2 };
	return { correct: false, grade: 1 };
}

export const REASON_ES: Record<'direction' | 'shape' | 'position' | 'tiny' | 'order', string> = {
	direction: 'Dirección al revés: empieza por el otro extremo.',
	shape: 'Ese no es el trazo que toca.',
	position: 'Bien la forma, pero en otro sitio.',
	tiny: 'Demasiado corto.',
	order: 'Ese trazo existe, pero va después: sigue el orden.'
};
