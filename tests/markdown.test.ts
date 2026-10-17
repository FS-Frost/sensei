import { expect, test } from 'bun:test';
import { renderMarkdown, renderFurigana } from '../src/lib/client/markdown.ts';

const opts = { readable: new Set<string>() };

test('listas numeradas continúan con líneas en blanco y sublistas (caso real del tutor)', () => {
	const md = [
		'1. **{日|ひ}**: es la palabra básica para «día».',
		'   * Ejemplo: {いい}日 (un buen día).',
		'',
		'2. **{一日|いちにち}**: significa «un día».',
		'',
		'3. **Lecturas en palabras compuestas**:',
		'   * **{にち}** o **{じつ}**: por ejemplo, en {毎日|まいにち}.'
	].join('\n');
	const html = renderMarkdown(md, opts);
	expect(html.match(/<ol/g)?.length).toBe(1); // una sola lista numerada
	expect(html).not.toContain('start=');
	expect(html.match(/<ul>/g)?.length).toBe(2); // sublistas anidadas
	expect(html).not.toMatch(/\{いい\}|\{にち\}|\{じつ\}/); // llaves sin barra limpias
	expect(html).toContain('<rt>まいにち</rt>');
});

test('lista que empieza en otro número conserva su inicio', () => {
	expect(renderMarkdown('3. tres\n4. cuatro', opts)).toContain('<ol start="3">');
});

test('párrafo tras lista la cierra', () => {
	const html = renderMarkdown('- a\n- b\n\nTexto final', opts);
	expect(html).toMatch(/<\/ul><p>Texto final<\/p>$/);
});

test('furigana con barra sigue funcionando y escapa HTML', () => {
	const html = renderFurigana('{漢字|かんじ}<b>', opts);
	expect(html).toContain('<rt>かんじ</rt>');
	expect(html).toContain('&lt;b&gt;');
});
