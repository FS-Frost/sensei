import type { PageLoad } from './$types';
import { serverLoad } from '#lib/client/backend.svelte.ts';
import type { load as L } from '#lib/server/loads/bienvenida.ts';

export const load: PageLoad = ({ params, url }) => serverLoad<typeof L>('bienvenida', params, url);
