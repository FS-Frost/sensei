// Componentes explicados: trazos del componente en KanjiVG, ficha (forma completa, ejemplos, distractores)
// y la explicación en pregen, export/import y «reiniciar generado».
import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { openDb } from '../src/lib/server/db/bun.ts';
import * as s from '../src/lib/server/db/schema.ts';
import { componentStrokes } from '../src/lib/strokes.ts';
import { getComponentInfo } from '../src/lib/server/items.ts';
import { applyPregen, collectGenerated, emptyPregen } from '../src/lib/server/data/pregen.ts';
import { applySnapshot, buildSnapshot } from '../src/lib/server/data/snapshot.ts';
import { applyReset } from '../src/lib/server/data/reset.ts';
import { componentsMissingExplanation, missingContent } from '../src/lib/server/gemini/pregen.ts';
import type { ComponentExplanation } from '../src/lib/types.ts';

// 泳 de KanjiVG (recortado): 氵 a la izquierda (variante de 水) + 永.
const EI = `<svg><g id="kvg:StrokePaths_06cf3"><g id="kvg:06cf3" kvg:element="泳">
	<g id="kvg:06cf3-g1" kvg:element="氵" kvg:variant="true" kvg:original="水" kvg:position="left" kvg:radical="general">
		<path id="kvg:06cf3-s1" d="M19.88,21.75c3.75,1.16,9.68,4.78,10.62,6.59"/>
		<path id="kvg:06cf3-s2" d="M15.75,44.5c4.06,1.15,10.48,4.72,11.5,6.5"/>
		<path id="kvg:06cf3-s3" d="M16,91.21c2,0.42,3.31-0.14,4.25-1.75"/>
	</g>
	<g id="kvg:06cf3-g2" kvg:element="永" kvg:position="right">
		<path id="kvg:06cf3-s4" d="M58,14c3,2,7,5,8,8"/>
		<g id="kvg:06cf3-g3" kvg:element="水"><path id="kvg:06cf3-s5" d="M60,30v60"/></g>
	</g>
</g></g><g id="kvg:StrokeNumbers_06cf3"><text>1</text></g></svg>`;

test('trazos del componente: los de su grupo, por elemento u original, y dónde va', () => {
	const r = componentStrokes(EI, ['氵', '水']);
	expect(r.paths.map((p) => p.on)).toEqual([true, true, true, false, true]);
	expect(r.position).toBe('left');
	// Solo 氵: el 水 dentro de 永 no cuenta.
	expect(componentStrokes(EI, ['氵']).paths.map((p) => p.on)).toEqual([true, true, true, false, false]);
	// El grupo raíz es el kanji entero: pedir «泳» no resalta todo.
	expect(componentStrokes(EI, ['泳']).paths.every((p) => !p.on)).toBe(true);
});

const EXPL: ComponentExplanation = {
	depicts: 'Tres gotas de agua.',
	why: 'Son gotas: agua.',
	role: 'Pista de significado, a la izquierda.',
	examples: [{ char: '泳', note: 'moverse en el agua' }],
	hook: 'Gotas que salpican.'
};

function base() {
	const db = openDb(':memory:').db;
	db.insert(s.kanji)
		.values([
			{ char: '水', meaningsEs: ['agua'], learnOrder: 0 },
			{ char: '泳', meaningsEs: ['nadar'], learnOrder: 5 },
			{ char: '海', meaningsEs: ['mar'], learnOrder: 9 },
			{ char: '日', meaningsEs: ['sol'], learnOrder: 1 },
			{ char: '月', meaningsEs: ['luna'], learnOrder: 2 },
			{ char: '目', meaningsEs: ['ojo'], learnOrder: 3 },
			{ char: '口', meaningsEs: ['boca'], learnOrder: 4 }
		])
		.run();
	db.insert(s.component)
		.values([
			{ symbol: '氵', nameEs: 'agua (gotas)', nameSource: 'static', learnOrder: 0 },
			{ symbol: '日', nameEs: 'sol', nameSource: 'kanji', learnOrder: 1 }
		])
		.run();
	db.insert(s.kanjiComponent)
		.values([
			{ kanji: '泳', symbol: '氵', position: 0 },
			{ kanji: '海', symbol: '氵', position: 0 },
			{ kanji: '日', symbol: '日', position: 0 }
		])
		.run();
	return db;
}

test('ficha: forma completa, ejemplos (lo que estudias primero) y distractores sin el componente', () => {
	const db = base();
	db.insert(s.card).values({ itemType: 'kanji', itemKey: '海', facet: 'meaning', due: 0, fsrs: {}, createdAt: 0 }).run();
	const c = getComponentInfo(db, '氵')!;
	expect(c.fullForm).toEqual({ char: '水', meaning: 'agua' });
	expect(c.examples.map((e) => e.char)).toEqual(['海', '泳']);
	expect(c.examples[0]).toMatchObject({ meaning: 'mar', status: 'learning' });
	expect(c.distractors.length).toBeGreaterThanOrEqual(3);
	expect(c.distractors).not.toContain('泳');
	expect(c.distractors).not.toContain('海');
	expect(c.explanation).toBeNull();
	// Componentes por explicar: los que no son kanji (日 se enseña como kanji).
	expect(componentsMissingExplanation(db, ['泳', '海', '日'])).toEqual(['氵']);
});

test('sin key: la lección cuenta lo que le falta (kanji sin mnemotecnia, componente sin explicación)', () => {
	const db = base();
	const comp = { type: 'component' as const, key: '氵', component: getComponentInfo(db, '氵')! };
	const kanji = { type: 'kanji' as const, key: '泳', kanji: { mnemonicMeaning: null } as never, similar: [] };
	expect(missingContent(db, [comp, kanji])).toEqual({ kanji: 1, components: 1, words: 0 });
	applyPregen(db, { ...emptyPregen(), componentExplanations: [{ symbol: '氵', explanation: EXPL }] });
	const done = { ...kanji, kanji: { mnemonicMeaning: 'algo' } as never };
	expect(missingContent(db, [comp, done])).toBeNull();
});

test('explicación: pregen sin pisar; se exporta solo la de Gemini; «reiniciar generado» la borra', () => {
	const db = base();
	expect(applyPregen(db, { ...emptyPregen(), componentExplanations: [{ symbol: '氵', explanation: EXPL }] })).toBe(1);
	expect(getComponentInfo(db, '氵')!.explanation).toEqual(EXPL);
	expect(collectGenerated(db, ['泳']).componentExplanations).toEqual([{ symbol: '氵', explanation: EXPL }]);
	expect(componentsMissingExplanation(db, ['泳'])).toEqual([]);
	// Pregenerada: no se exporta y sobrevive al reinicio.
	expect(buildSnapshot(db).content.componentExplanations).toEqual([]);
	applyReset(db, { generated: true });
	expect(getComponentInfo(db, '氵')!.explanation).toEqual(EXPL);

	// De Gemini: viaja en la copia y el reinicio la borra.
	db.update(s.component).set({ explanationSource: 'gemini' }).where(eq(s.component.symbol, '氵')).run();
	const snap = buildSnapshot(db);
	expect(snap.content.componentExplanations).toEqual([{ symbol: '氵', explanation: EXPL }]);
	applyReset(db, { generated: true });
	expect(getComponentInfo(db, '氵')!.explanation).toBeNull();
	applySnapshot(db, snap);
	expect(getComponentInfo(db, '氵')!.explanation).toEqual(EXPL);
	// Copias antiguas sin el campo siguen importando.
	const old = buildSnapshot(db);
	delete old.content.componentExplanations;
	expect(() => applySnapshot(db, old)).not.toThrow();
});
