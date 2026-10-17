import { expect, test } from 'bun:test';
import { computeLearnOrder } from '../src/lib/server/import/order.ts';

test('los componentes van antes que el kanji y los kanji-componente se enseñan como kanji', () => {
	const kanji = [
		{ char: '休', freq: 1, grade: 1, strokes: 6 },
		{ char: '木', freq: 2, grade: 1, strokes: 4 },
		{ char: '本', freq: 3, grade: 1, strokes: 5 }
	];
	const decomposition = new Map([
		['休', ['亻', '木']],
		['木', []],
		['本', ['木', '一']]
	]);
	const { kanji: ko, components: co } = computeLearnOrder(kanji, decomposition, () => 1);
	// 亻 (componente) < 木 (kanji, por ser componente de 休) < 休
	expect(co.get('亻')!).toBeLessThan(ko.get('休')!);
	expect(ko.get('木')!).toBeLessThan(ko.get('休')!);
	expect(co.has('木')).toBe(false);
	expect(co.get('一')!).toBeLessThan(ko.get('本')!);
	expect(ko.size).toBe(3);
});

test('tolera ciclos en la descomposición', () => {
	const kanji = [
		{ char: 'A', freq: 1, grade: 1, strokes: 1 },
		{ char: 'B', freq: 2, grade: 1, strokes: 1 }
	];
	const decomposition = new Map([
		['A', ['B']],
		['B', ['A']]
	]);
	const { kanji: ko } = computeLearnOrder(kanji, decomposition, () => 1);
	expect(ko.size).toBe(2);
});
