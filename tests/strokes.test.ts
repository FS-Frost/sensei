// Escritura: trazos de KanjiVG y comparación con lo dibujado (variaciones razonables sí; dirección u orden mal, no).
import { expect, test } from 'bun:test';
import { bestMatch, fitFrame, matchStroke, parseKanjiVG, pathPoints, resample, toTemplate, writingGrade, type Pt } from '../src/lib/strokes.ts';

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

test('exigencia: dibujo más pequeño y desplazado vale en normal (con tu marco), no en estricta; la dirección cuenta siempre', () => {
	const [h, v] = parseKanjiVG(JUU).map((d) => pathPoints(d));
	// El alumno escribe el kanji al 60 % y desplazado hacia arriba a la izquierda.
	const mine = (pts: Pt[]) => jitter(resample(pts, 20).map((p) => ({ x: p.x * 0.6 + 4, y: p.y * 0.6 + 2 })), 1.5);
	const h1 = mine(h);
	expect(matchStroke(h1, h, 'strict').ok).toBe(false);
	// Primer trazo: aún no hay marco; en normal se acepta por la forma, con aviso.
	const first = matchStroke(h1, h, 'normal');
	expect(first.ok).toBe(true);
	if (first.ok) expect(first.note).toBe('shifted');
	// Segundo trazo: ya con el marco del primero, cae en su sitio.
	const frame = fitFrame([{ drawn: h1, expected: h }]);
	expect(frame.scale).toBeGreaterThan(0.45);
	const v1 = mine(v);
	expect(matchStroke(toTemplate(v1, frame), v, 'normal').ok).toBe(true);
	expect(matchStroke(v1, v, 'strict').ok).toBe(false);
	// Al revés no vale en ningún nivel.
	for (const lvl of ['relaxed', 'normal', 'strict'] as const) {
		const r = matchStroke([...toTemplate(v1, frame)].reverse(), v, lvl);
		expect(r.ok, lvl).toBe(false);
		if (!r.ok) expect(r.reason).toBe('direction');
	}
	// Otro trazo (vertical en lugar del horizontal) tampoco, en ningún nivel ni desplazado.
	for (const lvl of ['relaxed', 'normal'] as const) {
		expect(matchStroke(resample(v, 20), h, lvl).ok, lvl).toBe(false);
		expect(matchStroke(resample(h, 20), v, lvl).ok, lvl).toBe(false);
		expect(matchStroke(resample(h, 20).map((p) => ({ x: p.x * 0.7 + 10, y: p.y * 0.7 + 5 })), v, lvl).ok, lvl).toBe(false);
	}
});

test('forma: una raya recta no vale por un «<» aunque baje igual', () => {
	// く: de arriba a la derecha, al centro a la izquierda, abajo a la derecha. い (1er trazo): casi vertical.
	const ku: Pt[] = [{ x: 62, y: 18 }, { x: 36, y: 54 }, { x: 64, y: 92 }];
	const line: Pt[] = [{ x: 40, y: 20 }, { x: 42, y: 56 }, { x: 46, y: 90 }];
	for (const lvl of ['relaxed', 'normal'] as const) {
		expect(matchStroke(resample(line, 20), resample(ku, 20), lvl).ok, lvl).toBe(false);
		// Y el propio «<» a mano, algo más pequeño, sí.
		const mine = jitter(resample(ku, 20).map((p) => ({ x: p.x * 0.85 + 6, y: p.y * 0.85 + 4 })), 1.5);
		expect(matchStroke(mine, resample(ku, 20), lvl).ok, lvl).toBe(true);
		// Tembloroso (dedo en el móvil), varias semillas: sigue valiendo.
		for (const seed of [1, 7, 42]) {
			const shaky = jitter(resample(ku, 24), 3, seed);
			expect(matchStroke(shaky, resample(ku, 20), lvl).ok, `${lvl} semilla ${seed}`).toBe(true);
		}
	}
});

test('calificación según fallos', () => {
	expect(writingGrade(0)).toEqual({ correct: true, grade: 3 });
	expect(writingGrade(2)).toEqual({ correct: true, grade: 2 });
	expect(writingGrade(3)).toEqual({ correct: false, grade: 1 });
});
