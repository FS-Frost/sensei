import type { PageLoad } from './$types';
import { serverLoad } from '#lib/client/backend.svelte.ts';
import type { load as L } from '#lib/server/loads/estadisticas.ts';

export const load: PageLoad = ({ params, url }) => serverLoad<typeof L>('estadisticas', params, url);
