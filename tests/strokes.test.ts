// Escritura: trazos de KanjiVG y comparación con lo dibujado (variaciones razonables sí; dirección u orden mal, no).
import { expect, test } from 'bun:test';
import { bestMatch, matchStroke, parseKanjiVG, pathPoints, resample, writingGrade, type Pt } from '../src/lib/strokes.ts';

// 十 de KanjiVG (dos trazos: horizontal y vertical), formato real con curvas relativas.
const JUU = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 109 109">
<g id="kvg:StrokePaths_05341"><g id="kvg:05341" kvg:element="十">
<path id="kvg:05341-s1" kvg:type="㇐" d="M13.5,54.18c2.07,0.43,5.89,0.49,7.96,0.43c18.29-0.5,49.19-2.82,69.05-2.59c3.45,0.04,5.53,0.21,7.27,0.42"/>
<path id="kvg:05341-s2" kvg:type="㇑" d="M53.48,12.5c1.03,1.03,1.79,2.62,1.79,4.12c0,15.38-0.02,71.38-0.02,80.38"/>
</g></g></svg>`;

const jitter = (pts: Pt[], amp: number, seed = 1) => {
	let x = seed;
	const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280 - 0.5) * 2;
	return pts.map((p) => ({ x: p.x + rnd() * amp, y: p.y + rnd() * amp }));
};

test('parse de KanjiVG: trazos en orden y puntos de las curvas', () => {
	const strokes = parseKanjiVG(JUU);
	expect(strokes).toHaveLength(2);
	const h = pathPoints(strokes[0]);
	expect(h[0]).toEqual({ x: 13.5, y: 54.18 });
	expect(h.at(-1)!.x).toBeCloseTo(98.0, 0); // horizontal: termina a la derecha
	const v = pathPoints(strokes[1]);
	expect(v.at(-1)!.y).toBeCloseTo(97.0, 0); // vertical: termina abajo
	expect(resample(h, 32)).toHaveLength(32);
	expect(pathPoints('M10,10 L20,10 H30 V40 Z').at(-1)).toEqual({ x: 10, y: 10 });
});

test('acepta un trazo a mano (tembloroso, algo desplazado); rechaza dirección invertida y otro trazo', () => {
	const [h, v] = parseKanjiVG(JUU).map((d) => pathPoints(d));
	const hand = jitter(resample(h, 20).map((p) => ({ x: p.x + 3, y: p.y + 4 })), 3);
	expect(matchStroke(hand, h).ok).toBe(true);
	const rev = matchStroke([...hand].reverse(), h);
	expect(rev.ok).toBe(false);
	if (!rev.ok) expect(rev.reason).toBe('direction');
	expect(matchStroke(resample(v, 20), h).ok).toBe(false);
	const tiny = matchStroke([{ x: 50, y: 50 }, { x: 51, y: 50 }], h);
	expect(tiny.ok).toBe(false);
	// Orden: dibujar el vertical primero coincide con el «siguiente» que no toca.
	expect(bestMatch(resample(v, 20), [h, v])).toBe(1);
});

test('calificación según fallos', () => {
	expect(writingGrade(0)).toEqual({ correct: true, grade: 3 });
	expect(writingGrade(2)).toEqual({ correct: true, grade: 2 });
	expect(writingGrade(3)).toEqual({ correct: false, grade: 1 });
});
