// Mensajes entre la página y el Worker que hace de servidor (src/lib/worker/backend.worker.ts).

export type DictVariant = 'common' | 'full';

export type DictPart = { file: string; bytes: number };
export type DictBuild = { bytes: number; gzBytes: number; parts: DictPart[]; kanji: number; vocab: number; sentences: number };
/** `dict/manifest.json`, generado por `bun run build:dict`. */
export type DictManifest = { version: string; createdAt: string; variants: Partial<Record<DictVariant, DictBuild>> };

export type BackendState =
	| { state: 'starting' }
	/** No hay base: hay que descargar el diccionario. */
	| { state: 'needs-dict'; manifest: DictManifest | null; error?: string }
	| { state: 'installing'; phase: 'download' | 'install' | 'restore'; loaded: number; total: number; variant: DictVariant }
	| {
			state: 'ready';
			dict: { version: string | null; variant: DictVariant };
			update: DictManifest | null;
			/** La última actualización del diccionario falló (se siguió con la base anterior). */
			updateError?: string;
	  }
	/** Otra pestaña ya tiene la base abierta. */
	| { state: 'locked' }
	/** El navegador no soporta OPFS con acceso síncrono. */
	| { state: 'unsupported'; error: string }
	| { state: 'error'; error: string };

export type ToWorker =
	| { type: 'init'; assets: string }
	| { type: 'install'; variant: DictVariant }
	| { type: 'fetch'; id: number; method: string; url: string; headers: [string, string][]; body: ArrayBuffer | null }
	| { type: 'abort'; id: number }
	| { type: 'load'; id: number; route: string; params: Record<string, string>; url: string };

export type LoadResult =
	| { ok: true; data: unknown }
	| { ok: false; redirect: { status: number; location: string } }
	| { ok: false; error: { status: number; message: string } };

export type FromWorker =
	| { type: 'state'; value: BackendState }
	| { type: 'response'; id: number; status: number; statusText: string; headers: [string, string][] }
	| { type: 'chunk'; id: number; chunk: Uint8Array }
	| { type: 'end'; id: number }
	| { type: 'fail'; id: number; message: string }
	| { type: 'loaded'; id: number; result: LoadResult };
