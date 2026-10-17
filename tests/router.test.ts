import { expect, test } from 'bun:test';
import { buildRoutes, dispatch, match, routePath } from '../src/lib/server/router.ts';

const ok = (name: string) => () => Response.json({ name });
const routes = buildRoutes({
	'/src/lib/server/api/chat/+server.ts': { GET: ok('list') },
	'/src/lib/server/api/chat/start/+server.ts': { POST: ok('start') },
	'/src/lib/server/api/chat/[id]/+server.ts': { GET: ok('get'), DELETE: ok('del') },
	'/src/lib/server/api/chat/[id]/end/+server.ts': { POST: ok('end') },
	'/src/lib/server/api/kanjivg/[char]/+server.ts': { GET: ok('svg') }
});

test('rutas: estáticas antes que dinámicas, parámetros decodificados', () => {
	expect(routePath('/src/lib/server/api/chat/[id]/end/+server.ts')).toBe('/api/chat/[id]/end');
	expect(match(routes, '/api/chat/start')?.route.path).toBe('/api/chat/start');
	expect(match(routes, '/api/chat/12')?.params).toEqual({ id: '12' });
	expect(match(routes, '/api/chat/12/end')?.route.path).toBe('/api/chat/[id]/end');
	expect(match(routes, `/api/kanjivg/${encodeURIComponent('日')}`)?.params).toEqual({ char: '日' });
	expect(match(routes, '/api/nada')).toBeNull();
});

test('métodos: 405 si no existe, HEAD usa GET, 404 si no hay ruta', async () => {
	const call = async (method: string, path: string) => {
		const r = await dispatch(routes, new Request(`http://x${path}`, { method }));
		return [r.status, r.status === 200 && method !== 'HEAD' ? ((await r.json()) as { name: string }).name : null];
	};
	expect(await call('POST', '/api/chat/start')).toEqual([200, 'start']);
	expect(await call('DELETE', '/api/chat/3')).toEqual([200, 'del']);
	expect(await call('POST', '/api/chat/3')).toEqual([405, null]);
	expect((await call('HEAD', '/api/chat'))[0]).toBe(200);
	expect(await call('GET', '/api/otra')).toEqual([404, null]);
});
