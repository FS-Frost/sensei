import { errorMessage, GeminiUnavailableError } from './gemini/client.ts';

export async function body<T>(request: Request): Promise<T> {
	try {
		return (await request.json()) as T;
	} catch {
		throw new HttpError(400, 'JSON inválido');
	}
}

export class HttpError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

/** Envuelve un handler: errores → JSON { error } con el status adecuado. */
export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
	try {
		return await fn();
	} catch (e) {
		if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
		if (e instanceof GeminiUnavailableError) return Response.json({ error: e.message }, { status: 503 });
		console.error('[api]', e);
		return Response.json({ error: errorMessage(e) }, { status: 500 });
	}
}
