// Sustituto de node:async_hooks para el navegador (vite.config.ts lo usa como alias).
// El navegador no tiene AsyncLocalStorage: este guarda el valor mientras dura `fn` (incluidas sus esperas).
// Si dos operaciones con `run` se solapan, la segunda tapa a la primera hasta que termina: para el uso
// actual (sumar el costo de una generación, ver gemini/usage.ts) el error posible es atribuir una
// llamada a la operación vecina. Un solo alumno rara vez lanza dos generaciones a la vez.

export class AsyncLocalStorage<T> {
	private stack: T[] = [];

	getStore(): T | undefined {
		return this.stack.at(-1);
	}

	run<R>(store: T, fn: () => R): R {
		this.stack.push(store);
		const pop = () => {
			const i = this.stack.lastIndexOf(store);
			if (i >= 0) this.stack.splice(i, 1);
		};
		try {
			const r = fn();
			if (r instanceof Promise) return r.finally(pop) as R;
			pop();
			return r;
		} catch (e) {
			pop();
			throw e;
		}
	}
}
