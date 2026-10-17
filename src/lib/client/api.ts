export class ApiError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

async function parse<T>(res: Response): Promise<T> {
	if (res.status === 204) return undefined as T;
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new ApiError(res.status, (data as { error?: string }).error ?? `Error ${res.status}`);
	}
	return data as T;
}

export async function get<T>(url: string): Promise<T> {
	return parse<T>(await fetch(url));
}

export async function post<T>(url: string, data: unknown = {}): Promise<T> {
	return parse<T>(
		await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
	);
}

export async function del(url: string): Promise<void> {
	await parse(await fetch(url, { method: 'DELETE' }));
}

/** POST que devuelve Server-Sent Events (`data: {json}`). */
export async function* postStream<T>(url: string, data: unknown, signal?: AbortSignal): AsyncGenerator<T> {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
		signal
	});
	if (!res.ok || !res.body) {
		await parse(res);
		return;
	}
	const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
	let buf = '';
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		buf += value;
		let idx: number;
		while ((idx = buf.indexOf('\n\n')) >= 0) {
			const chunk = buf.slice(0, idx);
			buf = buf.slice(idx + 2);
			const line = chunk.split('\n').find((l) => l.startsWith('data: '));
			if (line) yield JSON.parse(line.slice(6)) as T;
		}
	}
}

export function errMsg(e: unknown) {
	return e instanceof Error ? e.message : String(e);
}
