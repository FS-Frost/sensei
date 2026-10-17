import type { LayoutLoad } from './$types';
import { serverLoad } from '#lib/client/backend.svelte.ts';
import type { load as L } from '#lib/server/loads/layout.ts';

// Sitio estático (GitHub Pages): todo corre en el navegador; el «servidor» es un Worker.
export const ssr = false;
export const prerender = false;

export const load: LayoutLoad = ({ params, url }) => serverLoad<typeof L>('layout', params, url);
