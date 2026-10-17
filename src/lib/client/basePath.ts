// En GitHub Pages el sitio vive en /<repo>/ (paths.base), pero la app (y el contenido generado: siguiente paso,
// enlaces del tutor, Markdown) usa rutas absolutas «/tutor». En lugar de tocar cada enlace, este observador
// antepone la base a todo <a href="/…"> que no la tenga, en cuanto aparece en el DOM.
import { base } from './base.ts';

function fix(a: HTMLAnchorElement) {
	const href = a.getAttribute('href');
	if (!href || !href.startsWith('/') || href.startsWith('//')) return;
	if (href === base || href.startsWith(`${base}/`) || href.startsWith(`${base}?`) || href.startsWith(`${base}#`)) return;
	a.setAttribute('href', base + href);
}

/** Con base vacía (desarrollo local) no hace nada. */
export function startBaseLinks(root: HTMLElement = document.body) {
	if (!base) return () => {};
	root.querySelectorAll<HTMLAnchorElement>('a[href^="/"]').forEach(fix);
	const obs = new MutationObserver((muts) => {
		for (const m of muts) {
			if (m.type === 'attributes' && m.target instanceof HTMLAnchorElement) fix(m.target);
			for (const n of m.addedNodes) {
				if (n instanceof HTMLAnchorElement) fix(n);
				if (n instanceof HTMLElement) n.querySelectorAll<HTMLAnchorElement>('a[href^="/"]').forEach(fix);
			}
		}
	});
	obs.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['href'] });
	return () => obs.disconnect();
}

/** Para goto()/location: «/tutor» → «/<repo>/tutor». */
export function withBase(path: string) {
	return path.startsWith('/') && base && !path.startsWith(`${base}/`) ? base + path : path;
}
