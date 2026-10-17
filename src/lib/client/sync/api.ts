// SyncApi de la app: llamadas a /api/sync/* (las atiende el Worker de la base).
import { get, post } from '../api.ts';
import type { StateInfo, SyncApi } from './protocol.ts';

async function ok(res: Response) {
	if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Error ${res.status}`);
	return res;
}

export const syncApi: SyncApi = {
	state: (peer) => get<StateInfo>(`/api/sync/state${peer ? `?peer=${encodeURIComponent(peer)}` : ''}`),
	async snapshot() {
		const res = await ok(await fetch('/api/sync/snapshot'));
		return { bytes: new Uint8Array(await res.arrayBuffer()), hash: res.headers.get('X-Sensei-Hash') ?? '' };
	},
	async apply(bytes) {
		const res = await ok(await fetch('/api/sync/apply', { method: 'POST', body: bytes as Uint8Array<ArrayBuffer> }));
		return (await res.json()) as { hash: string };
	},
	async remember(p) {
		await post('/api/sync/peers', p);
	},
	async markSynced(id) {
		await ok(
			await fetch(`/api/sync/peers/${encodeURIComponent(id)}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ synced: true })
			})
		);
	}
};
