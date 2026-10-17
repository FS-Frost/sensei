// Protocolo de sincronización sobre un canal ya conectado (WebRTC en la app, uno simulado en los tests).
// Saludo → autenticación (recordados: HMAC; nuevos: código de 4 dígitos confirmado en ambos lados) →
// decidir quién gana → transferir el .zip en trozos → aplicar con copia previa → recordar. Ver docs/sync-qr.md.

export const PROTO = 1;
const CHUNK = 64 * 1024;

export type Transport = {
	send(data: string | ArrayBuffer): void | Promise<void>;
	onmessage: ((data: string | ArrayBuffer) => void) | null;
	close(): void;
};

export type StateInfo = {
	app: 'sensei';
	format: number;
	deviceId: string;
	hash: string;
	empty: boolean;
	counts: Record<string, number>;
	updatedAt: number | null;
	/** Si lo tengo recordado: su nombre y nuestra clave. */
	peer: { id: string; name: string; key: string; lastAt: number | null } | null;
	/** Mis datos cambiaron desde la última sincronización con él (null = sin historial). */
	changed: boolean | null;
};

/** Lo que el protocolo necesita del Worker (la app usa fetch a /api/sync/*; los tests, la base directa). */
export type SyncApi = {
	state(peerId?: string): Promise<StateInfo>;
	snapshot(): Promise<{ bytes: Uint8Array; hash: string }>;
	apply(bytes: Uint8Array): Promise<{ hash: string }>;
	remember(peer: { id: string; name: string; key: string }): Promise<void>;
	markSynced(peerId: string): Promise<void>;
};

export type Summary = { name: string; counts: Record<string, number>; updatedAt: number | null };
export type Decision = 'same' | 'send' | 'receive' | 'ask';

export type Status =
	| { step: 'handshake' }
	| { step: 'confirm'; code: string; peerName: string; waitingOther: boolean }
	| { step: 'ask'; mine: Summary; theirs: Summary; waitingOther: boolean }
	| { step: 'transfer'; direction: 'send' | 'receive'; done: number; total: number }
	| { step: 'done'; result: 'same' | 'sent' | 'received'; peerName: string; counts: Record<string, number>; remembered: boolean }
	| { step: 'error'; message: string };

type Msg =
	| { type: 'id'; app: string; proto: number; deviceId: string; name: string; nonce: string }
	| { type: 'hello'; format: number; hash: string; empty: boolean; counts: Record<string, number>; updatedAt: number | null; changed: boolean | null; known: boolean }
	| { type: 'auth'; mac: string }
	| { type: 'confirm'; ok: boolean }
	| { type: 'key'; key: string }
	| { type: 'choice'; keep: string }
	| { type: 'decided'; winner: string }
	| { type: 'transfer'; size: number; sha256: string }
	| { type: 'end' }
	| { type: 'applied'; hash: string }
	| { type: 'error'; message: string };

// ---------- Decisión (pura) ----------

type Side = { hash: string; empty: boolean; changed: boolean | null };

/**
 * Quién gana. Simétrica: si para A es «send», para B es «receive».
 * `changed` solo cuenta si ambos tienen historial común (se recuerdan).
 */
export function decide(me: Side, them: Side): Decision {
	if (me.hash === them.hash) return 'same';
	if (me.empty && them.empty) return 'same';
	if (me.empty) return 'receive';
	if (them.empty) return 'send';
	if (me.changed !== null && them.changed !== null) {
		if (!me.changed && !them.changed) return 'same';
		if (!me.changed && them.changed) return 'receive';
		if (me.changed && !them.changed) return 'send';
	}
	return 'ask';
}

// ---------- Cripto ----------

const enc = new TextEncoder();
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => {
	const t = s.replace(/-/g, '+').replace(/_/g, '/');
	return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
};
export const randomKey = () => b64u(crypto.getRandomValues(new Uint8Array(32)));

async function hmac(key: string, data: string) {
	const k = await crypto.subtle.importKey('raw', unb64u(key) as Uint8Array<ArrayBuffer>, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data))));
}

export async function sha256(bytes: Uint8Array) {
	return b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)));
}

// ---------- Sesión ----------

export type SessionOptions = {
	transport: Transport;
	api: SyncApi;
	/** El que emitió la oferta: decide en empates y genera la clave al recordar. */
	initiator: boolean;
	/** Nombre de este dispositivo («Edge · Windows»). */
	name: string;
	/** Código de 4 dígitos de esta conexión (de las huellas DTLS). */
	code: string;
	/** Material de la conexión para atar la autenticación HMAC a ella (huellas). */
	binding: string;
	remember: boolean;
	onStatus: (s: Status) => void;
};

export class SyncSession {
	private me!: StateInfo;
	private myNonce = randomKey();
	private peerId = '';
	private peerName = '';
	private theirNonce = '';
	private theirHello: Extract<Msg, { type: 'hello' }> | null = null;
	private authenticated = false;
	private confirmedHere = false;
	private confirmedThere = false;
	private sharedKey: string | null = null;
	private incoming: { size: number; sha256: string; parts: Uint8Array[]; got: number } | null = null;
	private finished = false;
	private queue: Promise<void> = Promise.resolve();
	private resolveDone!: (s: Status) => void;
	readonly done: Promise<Status>;
	remember: boolean;

	constructor(private o: SessionOptions) {
		this.remember = o.remember;
		this.done = new Promise((r) => (this.resolveDone = r));
		o.transport.onmessage = (d) => {
			// Mensajes en orden, uno tras otro (algunos esperan llamadas a la API).
			this.queue = this.queue.then(() => this.handle(d)).catch((e) => this.fail(e instanceof Error ? e.message : String(e), true));
		};
	}

	private status(s: Status) {
		this.o.onStatus(s);
		if (s.step === 'done' || s.step === 'error') {
			this.finished = true;
			this.resolveDone(s);
		}
	}

	private async send(m: Msg) {
		await this.o.transport.send(JSON.stringify(m));
	}

	private async fail(message: string, tell: boolean) {
		if (this.finished) return;
		if (tell) await Promise.resolve(this.send({ type: 'error', message })).catch(() => {});
		this.status({ step: 'error', message });
	}

	async start() {
		this.status({ step: 'handshake' });
		this.me = await this.o.api.state();
		await this.send({ type: 'id', app: 'sensei', proto: PROTO, deviceId: this.me.deviceId, name: this.o.name, nonce: this.myNonce });
	}

	/** El usuario confirma (o rechaza) que el código coincide. */
	async confirm(ok: boolean) {
		if (!ok) {
			await this.send({ type: 'confirm', ok: false });
			await this.fail('Cancelado: el código no coincidía', false);
			return;
		}
		this.confirmedHere = true;
		await this.send({ type: 'confirm', ok: true });
		await this.afterConfirm();
	}

	/**
	 * En conflicto: con qué datos quedarse. Cualquiera de los dos puede elegir; el iniciador fija la decisión
	 * (la primera elección que le llegue, la suya o la del otro) y la anuncia con «decided».
	 */
	async choose(keep: 'mine' | 'theirs') {
		if (this.decidedWinner) return;
		const winner = keep === 'mine' ? this.me.deviceId : this.peerId;
		if (this.o.initiator) return this.decideWinner(winner);
		await this.send({ type: 'choice', keep: winner });
		this.status({
			step: 'ask',
			mine: { name: this.o.name, counts: this.me.counts, updatedAt: this.me.updatedAt },
			theirs: { name: this.peerName, counts: this.theirHello!.counts, updatedAt: this.theirHello!.updatedAt },
			waitingOther: true
		});
	}

	private decidedWinner: string | null = null;
	private async decideWinner(winner: string) {
		if (this.decidedWinner) return;
		this.decidedWinner = winner;
		await this.send({ type: 'decided', winner });
		await this.actOn(winner);
	}

	private async actOn(winner: string) {
		if (winner === this.me.deviceId) return this.sendData();
		this.status({ step: 'transfer', direction: 'receive', done: 0, total: 0 });
	}

	async cancel() {
		await this.fail('Cancelado', true);
	}

	private async handle(d: string | ArrayBuffer) {
		if (this.finished) return;
		if (typeof d !== 'string') return this.onChunk(new Uint8Array(d));
		const m = JSON.parse(d) as Msg;
		switch (m.type) {
			case 'id': {
				if (m.app !== 'sensei' || m.proto !== PROTO) return this.fail('El otro dispositivo usa otra versión del protocolo: actualiza Sensei en ambos', true);
				this.peerId = m.deviceId;
				this.peerName = m.name;
				this.theirNonce = m.nonce;
				// Ahora que sé quién es, mi estado respecto a él.
				this.me = await this.o.api.state(this.peerId);
				await this.send({
					type: 'hello',
					format: this.me.format,
					hash: this.me.hash,
					empty: this.me.empty,
					counts: this.me.counts,
					updatedAt: this.me.updatedAt,
					changed: this.me.changed,
					known: !!this.me.peer
				});
				if (this.me.peer) await this.send({ type: 'auth', mac: await hmac(this.me.peer.key, `${this.theirNonce}|${this.o.binding}`) });
				return;
			}
			case 'hello': {
				this.theirHello = m;
				if (m.format > this.me.format) return this.fail('El otro dispositivo tiene una versión más nueva de Sensei: recarga esta página para actualizar', true);
				if (m.format < this.me.format) return this.fail('El otro dispositivo tiene una versión más vieja de Sensei: recárgalo para actualizar', true);
				// Sin recordarnos mutuamente: confirmación por código.
				if (!(m.known && this.me.peer)) this.askConfirm();
				return;
			}
			case 'auth': {
				const key = this.me.peer?.key;
				const ok = !!key && m.mac === (await hmac(key, `${this.myNonce}|${this.o.binding}`));
				if (!ok) {
					// Clave distinta (uno olvidó al otro): se cae a la confirmación por código.
					this.me = { ...this.me, peer: null, changed: null };
					this.askConfirm();
					return;
				}
				this.authenticated = true;
				this.sharedKey = key!;
				return this.proceed();
			}
			case 'confirm': {
				if (!m.ok) return this.fail('El otro dispositivo canceló: el código no coincidía', false);
				this.confirmedThere = true;
				return this.afterConfirm();
			}
			case 'key':
				this.sharedKey = m.key;
				return;
			case 'choice':
				// Solo el iniciador recibe elecciones (y se queda con la primera).
				if (this.o.initiator && (m.keep === this.me.deviceId || m.keep === this.peerId)) return this.decideWinner(m.keep);
				return;
			case 'decided':
				if (this.o.initiator) return;
				this.decidedWinner = m.winner;
				return this.actOn(m.winner);
			case 'transfer':
				this.incoming = { size: m.size, sha256: m.sha256, parts: [], got: 0 };
				this.status({ step: 'transfer', direction: 'receive', done: 0, total: m.size });
				return;
			case 'end':
				return this.onEnd();
			case 'applied':
				return this.finish('sent');
			case 'error':
				return this.fail(m.message, false);
		}
	}

	private askConfirm() {
		this.status({ step: 'confirm', code: this.o.code, peerName: this.peerName, waitingOther: this.confirmedHere });
	}

	private async afterConfirm() {
		if (this.confirmedHere && !this.confirmedThere) {
			this.askConfirm();
			return;
		}
		if (!(this.confirmedHere && this.confirmedThere)) return;
		// Recién emparejados: el iniciador propone la clave compartida para recordarse.
		if (this.o.initiator && !this.sharedKey) {
			this.sharedKey = randomKey();
			await this.send({ type: 'key', key: this.sharedKey });
		}
		await this.proceed();
	}

	private decision(): Decision {
		const t = this.theirHello!;
		const trusted = this.authenticated; // `changed` solo vale con historial común verificado
		return decide(
			{ hash: this.me.hash, empty: this.me.empty, changed: trusted ? this.me.changed : null },
			{ hash: t.hash, empty: t.empty, changed: trusted ? t.changed : null }
		);
	}

	private async proceed() {
		if (!this.theirHello) return;
		const d = this.decision();
		if (d === 'same') return this.finish('same');
		if (d === 'send') return this.sendData();
		if (d === 'receive') return; // espera «transfer»
		this.status({
			step: 'ask',
			mine: { name: this.o.name, counts: this.me.counts, updatedAt: this.me.updatedAt },
			theirs: { name: this.peerName, counts: this.theirHello.counts, updatedAt: this.theirHello.updatedAt },
			waitingOther: false
		});
	}

	private sending = false;
	private async sendData() {
		if (this.sending) return;
		this.sending = true;
		const { bytes } = await this.o.api.snapshot();
		await this.send({ type: 'transfer', size: bytes.length, sha256: await sha256(bytes) });
		for (let i = 0; i < bytes.length; i += CHUNK) {
			const part = bytes.slice(i, i + CHUNK);
			await this.o.transport.send(part.buffer);
			this.status({ step: 'transfer', direction: 'send', done: Math.min(bytes.length, i + CHUNK), total: bytes.length });
		}
		await this.send({ type: 'end' });
	}

	private onChunk(part: Uint8Array) {
		if (!this.incoming) return;
		this.incoming.parts.push(part);
		this.incoming.got += part.length;
		this.status({ step: 'transfer', direction: 'receive', done: this.incoming.got, total: this.incoming.size });
	}

	private async onEnd() {
		const inc = this.incoming;
		if (!inc) return;
		const all = new Uint8Array(inc.got);
		let off = 0;
		for (const p of inc.parts) {
			all.set(p, off);
			off += p.length;
		}
		if (inc.got !== inc.size || (await sha256(all)) !== inc.sha256) return this.fail('Los datos llegaron incompletos o dañados: vuelve a intentarlo', true);
		const r = await this.o.api.apply(all);
		await this.send({ type: 'applied', hash: r.hash });
		await this.finish('received');
	}

	private async finish(result: 'same' | 'sent' | 'received') {
		let remembered = false;
		if (this.authenticated) {
			await this.o.api.markSynced(this.peerId);
			remembered = true;
		} else if (this.remember && this.sharedKey) {
			await this.o.api.remember({ id: this.peerId, name: this.peerName, key: this.sharedKey });
			await this.o.api.markSynced(this.peerId);
			remembered = true;
		}
		const st = await this.o.api.state();
		this.status({ step: 'done', result, peerName: this.peerName, counts: st.counts, remembered });
	}
}
