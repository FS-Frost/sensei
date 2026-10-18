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

/** Posiciones de KanjiVG (`kvg:position`) en español. */
export const POSITION_ES: Record<string, string> = {
	left: 'a la izquierda',
	right: 'a la derecha',
	top: 'arriba',
	bottom: 'abajo',
	nyo: 'abajo, envolviendo',
	tare: 'arriba a la izquierda, colgando',
	kamae: 'alrededor',
	tarec: 'colgando',
	nyoc: 'envolviendo'
};

/**
 * Trazos de un SVG de KanjiVG marcando cuáles pertenecen a un componente: los que están dentro de un grupo
 * cuyo `kvg:element` o `kvg:original` es uno de `symbols` (p. ej. ['氵', '水']). También devuelve dónde va.
 */
export function componentStrokes(svg: string, symbols: string[]): { paths: { d: string; on: boolean }[]; position: string | null } {
	const want = new Set(symbols);
	const stack: boolean[] = [];
	const paths: { d: string; on: boolean }[] = [];
	let position: string | null = null;
	for (const m of svg.matchAll(/<g\b[^>]*>|<\/g>|<path\b[^>]*>/g)) {
		const tag = m[0];
		if (tag === '</g>') {
			stack.pop();
			continue;
		}
		if (tag.startsWith('<g')) {
			const el = tag.match(/kvg:element="([^"]+)"/)?.[1];
			const orig = tag.match(/kvg:original="([^"]+)"/)?.[1];
			const hit = (el !== undefined && want.has(el)) || (orig !== undefined && want.has(orig));
			// El grupo raíz es el propio kanji: no cuenta aunque coincida con la forma completa.
			const root = /id="kvg:[0-9a-f]+"/.test(tag);
			if (hit && !root && !(stack.at(-1) ?? false)) position ??= tag.match(/kvg:position="([^"]+)"/)?.[1] ?? null;
			stack.push((stack.at(-1) ?? false) || (hit && !root));
			continue;
		}
		const d = tag.match(/\bd="([^"]+)"/)?.[1];
		if (d && /-s\d+"/.test(tag)) paths.push({ d, on: stack.at(-1) ?? false });
	}
	return { paths, position };
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
	| { ok: true; score: number; /** Aceptado, pero algo corrido o aproximado (aviso suave). */ note?: 'shifted' | 'rough' }
	| { ok: false; reason: 'direction' | 'shape' | 'position' | 'tiny'; score: number };

/**
 * Exigencia de la corrección (ajuste `writingStrictness`):
 * - `strict`: posición absoluta en la plantilla (la de siempre).
 * - `normal`: compara contra la escala y posición de tu propio dibujo (ver `fitFrame`); desvíos leves no cuentan.
 * - `relaxed`: forma aproximada; solo cuentan de verdad la dirección y el orden.
 */
export type Strictness = 'relaxed' | 'normal' | 'strict';

/**
 * `tol`: multiplica la tolerancia en el sitio. `shape`: la de la forma (comparación centrada, sin posición).
 * `angle`: desvío máximo (grados) de la dirección general del trazo (inicio → final), para no aceptar
 * una raya horizontal donde va una vertical aunque «se parezcan» centradas.
 */
const LEVEL: Record<Strictness, { tol: number; startEnd: number; acceptShift: number; shape: number; angle: number; bend: number }> = {
	strict: { tol: 1, startEnd: 1.6, acceptShift: 0, shape: 1, angle: 180, bend: 180 },
	normal: { tol: 1.2, startEnd: 1.9, acceptShift: 2.2, shape: 1, angle: 40, bend: 26 },
	relaxed: { tol: 1.5, startEnd: 2.4, acceptShift: Infinity, shape: 1.3, angle: 55, bend: 31 }
};

/**
 * Forma «de verdad»: diferencia media (grados) de la dirección de cada tramo, recorriendo los dos trazos a la par.
 * Una raya recta y un «<» pueden quedar cerca en distancia, pero giran distinto: aquí se separan.
 */
function bendDiff(a: Pt[], b: Pt[]): number {
	const ra = resample(a, 12);
	const rb = resample(b, 12);
	let sum = 0;
	let n = 0;
	for (let i = 1; i < ra.length; i++) {
		const da = Math.atan2(ra[i].y - ra[i - 1].y, ra[i].x - ra[i - 1].x);
		const db = Math.atan2(rb[i].y - rb[i - 1].y, rb[i].x - rb[i - 1].x);
		const d = Math.abs(da - db) * (180 / Math.PI);
		sum += Math.min(d, 360 - d);
		n++;
	}
	return n ? sum / n : 0;
}

/** Diferencia (grados) entre la dirección general de dos trazos; 0 si alguno es casi un punto. */
function angleDiff(a: Pt[], b: Pt[]): number {
	const va = { x: a.at(-1)!.x - a[0].x, y: a.at(-1)!.y - a[0].y };
	const vb = { x: b.at(-1)!.x - b[0].x, y: b.at(-1)!.y - b[0].y };
	if (Math.hypot(va.x, va.y) < 6 || Math.hypot(vb.x, vb.y) < 6) return 0;
	const d = Math.abs(Math.atan2(va.y, va.x) - Math.atan2(vb.y, vb.x)) * (180 / Math.PI);
	return Math.min(d, 360 - d);
}

const centered = (p: Pt[]) => {
	const c = p.reduce((s, q) => ({ x: s.x + q.x / p.length, y: s.y + q.y / p.length }), { x: 0, y: 0 });
	return p.map((q) => ({ x: q.x - c.x, y: q.y - c.y }));
};

/**
 * ¿El trazo dibujado (en coordenadas de la caja 109×109) es el esperado?
 * Tolerancia según la longitud del trazo esperado: los cortos (点) piden menos precisión absoluta.
 */
export function matchStroke(drawn: Pt[], expected: Pt[], level: Strictness = 'strict'): StrokeVerdict {
	const L = LEVEL[level];
	const expLen = length(expected);
	const drawnLen = length(drawn);
	if (drawnLen < Math.min(4, expLen * 0.3)) return { ok: false, reason: 'tiny', score: Infinity };
	const a = resample(drawn);
	const b = resample(expected);
	const tol = Math.min(17, Math.max(9, 0.22 * expLen + 6)) * L.tol;
	const fwd = meanDist(a, b);
	const rev = meanDist([...a].reverse(), b);
	const startEnd = Math.max(Math.hypot(a[0].x - b[0].x, a[0].y - b[0].y), Math.hypot(a.at(-1)!.x - b.at(-1)!.x, a.at(-1)!.y - b.at(-1)!.y));
	const angle = angleDiff(a, b);
	// Orientación general y giros parecidos (fuera de «estricta», que ya exige el sitio exacto).
	const aligned = angle <= L.angle && (level === 'strict' || expLen < 12 || bendDiff(a, b) <= L.bend);
	if (fwd <= tol && startEnd <= tol * L.startEnd && aligned)
		return { ok: true, score: fwd, note: level !== 'strict' && fwd > tol / L.tol ? 'rough' : undefined };
	// La dirección cuenta en todos los niveles: es lo que se aprende al escribir.
	const ca = centered(a);
	const cb = centered(b);
	const shapeTol = (tol / L.tol) * L.shape;
	const shapeFwd = meanDist(ca, cb);
	const shapeRev = meanDist([...ca].reverse(), cb);
	if ((rev <= tol && rev < fwd) || (shapeRev <= shapeTol && shapeRev < shapeFwd && shapeFwd > shapeTol) || angle >= 180 - L.angle)
		return { ok: false, reason: 'direction', score: fwd };
	// Forma correcta pero desplazada: en normal se acepta si no está muy lejos; en relajada, siempre.
	if (shapeFwd <= shapeTol && aligned) {
		const offset = Math.hypot(a[0].x - ca[0].x - (b[0].x - cb[0].x), a[0].y - ca[0].y - (b[0].y - cb[0].y));
		if (offset <= (tol / L.tol) * L.acceptShift) return { ok: true, score: fwd, note: 'shifted' };
		return { ok: false, reason: 'position', score: fwd };
	}
	return { ok: false, reason: 'shape', score: fwd };
}

/** Escala y desplazamiento de tu dibujo respecto a la plantilla: dibujado ≈ escala · plantilla + (dx, dy). */
export type Frame = { scale: number; dx: number; dy: number };

/**
 * Ajusta por mínimos cuadrados el marco de tu dibujo con los trazos ya aceptados (pares dibujado/plantilla).
 * Así, si escribes el kanji más pequeño o más a un lado, los trazos siguientes se comparan en tu tamaño y sitio.
 * Escala acotada (0,55-1,6) y 1 si los trazos aún no dan información de tamaño (un punto).
 */
export function fitFrame(pairs: { drawn: Pt[]; expected: Pt[] }[]): Frame {
	const d: Pt[] = [];
	const e: Pt[] = [];
	for (const p of pairs) {
		d.push(...resample(p.drawn, 16));
		e.push(...resample(p.expected, 16));
	}
	if (!d.length) return { scale: 1, dx: 0, dy: 0 };
	const mean = (ps: Pt[]) => ps.reduce((s, q) => ({ x: s.x + q.x / ps.length, y: s.y + q.y / ps.length }), { x: 0, y: 0 });
	const md = mean(d);
	const me = mean(e);
	let num = 0;
	let den = 0;
	for (let i = 0; i < d.length; i++) {
		num += (e[i].x - me.x) * (d[i].x - md.x) + (e[i].y - me.y) * (d[i].y - md.y);
		den += (e[i].x - me.x) ** 2 + (e[i].y - me.y) ** 2;
	}
	const scale = den > 25 ? Math.min(1.6, Math.max(0.55, num / den)) : 1;
	return { scale, dx: md.x - scale * me.x, dy: md.y - scale * me.y };
}

/** Lleva un trazo dibujado al marco de la plantilla (deshace tu escala y desplazamiento). */
export function toTemplate(pts: Pt[], f: Frame): Pt[] {
	return pts.map((p) => ({ x: (p.x - f.dx) / f.scale, y: (p.y - f.dy) / f.scale }));
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

/** Avisos suaves de un trazo aceptado (no cuentan como fallo). */
export const NOTE_ES: Record<'shifted' | 'rough', string> = {
	shifted: 'Bien, aunque un poco corrido.',
	rough: 'Bien (aproximado).'
};

export const REASON_ES: Record<'direction' | 'shape' | 'position' | 'tiny' | 'order', string> = {
	direction: 'Dirección al revés: empieza por el otro extremo.',
	shape: 'Ese no es el trazo que toca.',
	position: 'Bien la forma, pero en otro sitio.',
	tiny: 'Demasiado corto.',
	order: 'Ese trazo existe, pero va después: sigue el orden.'
};
