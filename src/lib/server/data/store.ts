// Almacén de archivos para las copias de seguridad.
// Navegador: OPFS (carpeta `backups/` del origen). Bun (tests): una carpeta del disco (store-fs.ts).

export type StoredFile = { name: string; size: number };

export interface BlobStore {
	list(): Promise<StoredFile[]>;
	read(name: string): Promise<Uint8Array | null>;
	write(name: string, bytes: Uint8Array): Promise<void>;
	remove(name: string): Promise<void>;
}

/** Carpeta de OPFS (Origin Private File System). Funciona en la página y en Workers. */
export function opfsStore(folder: string): BlobStore {
	const dir = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(folder, { create: true });
	return {
		async list() {
			const out: StoredFile[] = [];
			const d = await dir();
			for await (const [name, h] of (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
				if (h.kind === 'file') out.push({ name, size: (await (h as FileSystemFileHandle).getFile()).size });
			}
			return out;
		},
		async read(name) {
			try {
				const f = await (await (await dir()).getFileHandle(name)).getFile();
				return new Uint8Array(await f.arrayBuffer());
			} catch {
				return null;
			}
		},
		async write(name, bytes) {
			const h = await (await dir()).getFileHandle(name, { create: true });
			const w = await h.createWritable();
			await w.write(bytes as Uint8Array<ArrayBuffer>);
			await w.close();
		},
		async remove(name) {
			await (await dir()).removeEntry(name).catch(() => {});
		}
	};
}

/** En memoria (por defecto hasta que el Worker configure OPFS; útil en tests). */
export function memoryStore(): BlobStore {
	const files = new Map<string, Uint8Array>();
	return {
		list: async () => [...files].map(([name, b]) => ({ name, size: b.byteLength })),
		read: async (name) => files.get(name) ?? null,
		write: async (name, bytes) => void files.set(name, bytes),
		remove: async (name) => void files.delete(name)
	};
}
