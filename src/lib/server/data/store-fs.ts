// Almacén en una carpeta del disco (solo Bun: tests y scripts).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BlobStore } from './store.ts';

export function fsStore(dir: string): BlobStore {
	return {
		list: async () =>
			existsSync(dir) ? readdirSync(dir).map((name) => ({ name, size: statSync(join(dir, name)).size })) : [],
		read: async (name) => (existsSync(join(dir, name)) ? new Uint8Array(readFileSync(join(dir, name))) : null),
		write: async (name, bytes) => {
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, name), bytes);
		},
		remove: async (name) => {
			if (existsSync(join(dir, name))) unlinkSync(join(dir, name));
		}
	};
}
