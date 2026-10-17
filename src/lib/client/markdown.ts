// Markdown mínimo y seguro (escapa HTML) + notación de furigana {漢字|かんじ} → <ruby>.
import { isKanjiChar } from '../jp.ts';

function escape(s: string) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export type FuriOpts = { readable: Set<string> };

function rubyHtml(base: string, reading: string, opts: FuriOpts) {
	const ks = [...base].filter(isKanjiChar);
	const known = ks.length > 0 && ks.every((k) => opts.readable.has(k));
	return `<ruby class="${known ? 'known' : ''}" data-lookup="${base}">${base}<rt>${reading}</rt></ruby>`;
}

/** Furigana + envoltura de kanji sueltos para el diccionario. Recibe texto YA escapado. */
function furigana(escaped: string, opts: FuriOpts) {
	const parts: string[] = [];
	const re = /\{([^|{}]+)\|([^{}]+)\}/g;
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(escaped))) {
		parts.push(wrapKanjiLong(escaped.slice(last, m.index)));
		parts.push(rubyHtml(m[1], m[2], opts));
		last = m.index + m[0].length;
	}
	parts.push(wrapKanjiLong(escaped.slice(last)));
	// Llaves sin barra ({いい}, {にち}): el modelo a veces las usa mal; se muestra el contenido limpio.
	return parts.join('').replace(/\{([^{}|<>]+)\}/g, '$1');
}

/** Secuencias de kanji (+ okurigana inmediato) → span consultable. Sin uso: ver wrapKanjiLong. */
export function wrapKanjiShort(s: string) {
	return s.replace(/[㐀-鿿豈-﫿々]+[ぁ-ゖ]{0,3}/g, (w) => {
		const base = w.replace(/[ぁ-ゖ]+$/, '');
		return `<span data-lookup="${base}" data-b="${w}">${w}</span>`;
	});
}

/**
 * Como wrapKanjiShort pero arrastra hasta 10 kana siguientes en data-b para poder deconjugar (読まれなかった).
 * Solo se resalta kanji + 3 kana.
 */
function wrapKanjiLong(s: string) {
	return s.replace(/([㐀-鿿豈-﫿々]+)([ぁ-ゖ]{0,10})/g, (_w, k: string, kana: string) => {
		return `<span data-lookup="${k}" data-b="${k + kana}">${k + kana.slice(0, 3)}</span>${kana.slice(3)}`;
	});
}

function inline(s: string, opts: FuriOpts) {
	let out = escape(s);
	// code primero para no procesar su interior
	const codes: string[] = [];
	out = out.replace(/`([^`]+)`/g, (_, c) => {
		codes.push(c);
		return `\u0000${codes.length - 1}\u0000`;
	});
	out = furigana(out, opts);
	out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
	out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
	return out;
}

type ListItem = { kind: 'ul' | 'ol'; indent: number; num: number; text: string };

function parseListItem(line: string): ListItem | null {
	const ul = line.match(/^(\s*)[-*•]\s+(.*)$/);
	if (ul) return { kind: 'ul', indent: ul[1].replace(/\t/g, '  ').length, num: 0, text: ul[2] };
	const ol = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
	if (ol) return { kind: 'ol', indent: ol[1].replace(/\t/g, '  ').length, num: Number(ol[2]), text: ol[3] };
	return null;
}

/**
 * Markdown sencillo con listas anidadas por sangría. Las listas numeradas conservan su número
 * (`<ol start>`) y continúan aunque haya líneas en blanco o sublistas entre sus ítems.
 */
export function renderMarkdown(text: string, opts: FuriOpts): string {
	const lines = text.replace(/\r/g, '').split('\n');
	const html: string[] = [];
	let para: string[] = [];
	// Pila de listas abiertas; cada nivel recuerda si su último <li> sigue abierto.
	const stack: { kind: 'ul' | 'ol'; indent: number; liOpen: boolean }[] = [];

	const flushPara = () => {
		if (para.length) html.push(`<p>${para.map((l) => inline(l, opts)).join('<br>')}</p>`);
		para = [];
	};
	const closeTop = () => {
		const top = stack.pop()!;
		if (top.liOpen) html.push('</li>');
		html.push(`</${top.kind}>`);
	};
	const closeAll = () => {
		while (stack.length) closeTop();
	};
	const nextNonEmpty = (i: number) => {
		for (let j = i + 1; j < lines.length; j++) if (lines[j].trim()) return lines[j];
		return null;
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trimEnd();
		const item = parseListItem(line);
		const h = line.match(/^(#{1,4})\s+(.*)$/);
		if (item) {
			flushPara();
			while (stack.length && stack[stack.length - 1].indent > item.indent) closeTop();
			let top = stack[stack.length - 1];
			if (top && top.indent === item.indent && top.kind !== item.kind) {
				closeTop();
				top = stack[stack.length - 1];
			}
			if (!top || top.indent < item.indent) {
				html.push(item.kind === 'ol' && item.num !== 1 ? `<ol start="${item.num}">` : `<${item.kind}>`);
				stack.push({ kind: item.kind, indent: item.indent, liOpen: false });
				top = stack[stack.length - 1];
			}
			if (top.liOpen) html.push('</li>');
			html.push(`<li>${inline(item.text, opts)}`);
			top.liOpen = true;
		} else if (h) {
			flushPara();
			closeAll();
			const level = Math.min(4, h[1].length + 2);
			html.push(`<h${level}>${inline(h[2], opts)}</h${level}>`);
		} else if (!line.trim()) {
			flushPara();
			// Una línea en blanco no corta la lista si lo siguiente es otro ítem.
			const next = nextNonEmpty(i);
			if (!next || !parseListItem(next)) closeAll();
		} else if (stack.length && /^\s{2,}\S/.test(line)) {
			// Continuación sangrada de un ítem.
			html.push(`<br>${inline(line.trim(), opts)}`);
		} else {
			closeAll();
			para.push(line);
		}
	}
	flushPara();
	closeAll();
	return html.join('');
}

/** Solo furigana (sin markdown), para enunciados de quiz. */
export function renderFurigana(text: string, opts: FuriOpts): string {
	return furigana(escape(text), opts);
}
