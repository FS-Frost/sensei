// Sincronización P2P: decisión, señas compactas y el protocolo completo entre dos bases reales
// conectadas por un canal simulado (sin WebRTC).
import { describe, expect, test } from 'bun:test';
import { openDb, type DB } from '../src/lib/server/db/bun.ts';
import * as s from '../src/lib/server/db/schema.ts';
import { applyReview, ensureCard } from '../src/lib/server/srs/service.ts';
import { applySnapshot, buildSnapshot, snapshotHash } from '../src/lib/server/data/snapshot.ts';
import { applySync, getPeer, listPeers, markSynced, stateFor, syncState, syncZip, upsertPeer } from '../src/lib/server/sync.ts';
import { decide, SyncSession, type Status, type SyncApi, type Transport } from '../src/lib/client/sync/protocol.ts';
import { confirmationCode, decode, encode, fromSdp, pickCandidate, toSdp } from '../src/lib/client/sync/signal.ts';

// ---------- Decisión ----------

describe('quién gana', () => {
	const side = (hash: string, empty = false, changed: boolean | null = null) => ({ hash, empty, changed });
	test('tabla de casos y simetría', () => {
		expect(decide(side('a'), side('a'))).toBe('same');
		expect(decide(side('a', true), side('b', true))).toBe('same');
		expect(decide(side('a', true), side('b'))).toBe('receive');
		expect(decide(side('a'), side('b', true))).toBe('send');
		expect(decide(side('a', false, false), side('b', false, false))).toBe('same'); // sincronizados antes, nada cambió
		expect(decide(side('a', false, false), side('b', false, true))).toBe('receive');
		expect(decide(side('a', false, true), side('b', false, false))).toBe('send');
		expect(decide(side('a', false, true), side('b', false, true))).toBe('ask');
		expect(decide(side('a'), side('b'))).toBe('ask'); // primera vez, ambos con datos
		const flip = { send: 'receive', receive: 'send', same: 'same', ask: 'ask' } as const;
		for (const [x, y] of [
			[side('a', true), side('b')],
			[side('a', false, false), side('b', false, true)]
		])
			expect(decide(y, x)).toBe(flip[decide(x, y)]);
	});
});

// ---------- Señas compactas ----------

const CHROME_OFFER = [
	'v=0',
	'o=- 8126398126391 2 IN IP4 127.0.0.1',
	's=-',
	't=0 0',
	'a=group:BUNDLE 0',
	'a=extmap-allow-mixed',
	'a=msid-semantic: WMS',
	'm=application 52101 UDP/DTLS/SCTP webrtc-datachannel',
	'c=IN IP4 0.0.0.0',
	'a=candidate:3907419462 1 udp 2113937151 0d1e2f3a-4b5c-4d6e-8f70-91a2b3c4d5e6.local 52101 typ host generation 0 network-cost 999',
	'a=candidate:842163049 1 udp 2113939711 2001:db8::1 52102 typ host generation 0 network-cost 999',
	'a=ice-ufrag:x9Kp',
	'a=ice-pwd:Q2w3E4r5T6y7U8i9O0p1A2s3',
	'a=ice-options:trickle',
	'a=fingerprint:sha-256 4E:1A:7C:00:FF:12:34:56:78:9A:BC:DE:F0:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:01:23:45:67',
	'a=setup:actpass',
	'a=mid:0',
	'a=sctp-port:5000',
	'a=max-message-size:262144',
	''
].join('\r\n');

describe('señas compactas', () => {
	test('caben en un mensaje de ggwave (≤140) y la ida y vuelta conserva todo', () => {
		const sig = fromSdp(CHROME_OFFER, 'offer', 300, Date.parse('2026-10-18T10:00:00Z'));
		expect(sig.address).toMatch(/\.local$/); // prefiere mDNS a IPv6
		const text = encode(sig);
		expect(text.length).toBeLessThanOrEqual(140);
		const back = decode(text);
		expect(back).toEqual(sig);
		const sdp = toSdp(back);
		expect(sdp.type).toBe('offer');
		// El SDP reconstruido vuelve a dar las mismas señas.
		expect(encode(fromSdp(sdp.sdp, 'offer', 300, Date.parse('2026-10-18T10:00:00Z')))).toBe(text);
		expect(sdp.sdp).toContain('a=setup:actpass');
		expect(sdp.sdp).toContain('0d1e2f3a-4b5c-4d6e-8f70-91a2b3c4d5e6.local 52101 typ host');
	});

	test('IPv4 preferida; credenciales hexadecimales de Firefox comprimidas; respuesta active', () => {
		const ff = CHROME_OFFER.replace('a=ice-ufrag:x9Kp', 'a=ice-ufrag:3f2a9c1b')
			.replace('a=ice-pwd:Q2w3E4r5T6y7U8i9O0p1A2s3', 'a=ice-pwd:0123456789abcdef0123456789abcdef')
			.replace('a=setup:actpass', 'a=setup:active')
			.replace('a=candidate:842163049 1 udp 2113939711 2001:db8::1 52102', 'a=candidate:842163049 1 udp 2113939711 192.168.1.23 52102');
		expect(pickCandidate(ff)).toEqual({ address: '192.168.1.23', port: 52102 });
		const sig = fromSdp(ff, 'answer');
		expect(sig.role).toBe('a');
		const text = encode(sig);
		expect(text).toContain('~.'); // pwd comprimido
		expect(text.length).toBeLessThan(120);
		expect(decode(text).pwd).toBe('0123456789abcdef0123456789abcdef');
		expect(toSdp(decode(text)).sdp).toContain('a=setup:active');
	});

	test('códigos ajenos o dañados se rechazan; el código de confirmación es simétrico', async () => {
		expect(() => decode('hola')).toThrow('no es de Sensei');
		const a = crypto.getRandomValues(new Uint8Array(32));
		const b = crypto.getRandomValues(new Uint8Array(32));
		expect(await confirmationCode(a, b)).toBe(await confirmationCode(b, a));
		expect(await confirmationCode(a, b)).toMatch(/^\d{4}$/);
	});
});

test('QR: el enlace de una oferta real se genera y se vuelve a leer (uqr → jsQR)', async () => {
	const { encode: qrEncode } = await import('uqr');
	const jsQR = (await import('jsqr')).default;
	const offer = encode(fromSdp(CHROME_OFFER, 'offer'));
	const link = `https://fs-frost.github.io/sensei/sincronizar#s=${encodeURIComponent(offer)}`;
	const { data } = qrEncode(link, { ecc: 'L', border: 2 });
	const scale = 6;
	const n = data.length * scale;
	const px = new Uint8ClampedArray(n * n * 4);
	for (let y = 0; y < n; y++)
		for (let x = 0; x < n; x++) {
			const v = data[Math.floor(y / scale)][Math.floor(x / scale)] ? 0 : 255;
			px.set([v, v, v, 255], (y * n + x) * 4);
		}
	const read = jsQR(px, n, n)?.data;
	expect(read).toBe(link);
	expect(decode(decodeURIComponent(read!.split('#s=')[1]))).toEqual(decode(offer));
});

// ---------- Snapshot determinista ----------

function seededDb() {
	const db = openDb(':memory:').db;
	db.insert(s.kanji).values([{ char: '山', meaningsEs: ['montaña'], onReadings: ['サン'], kunReadings: ['やま'], learnOrder: 0 }, { char: '川', meaningsEs: ['río'], learnOrder: 1 }]).run();
	return db;
}

function review(db: DB, key: string, at: number) {
	const c = ensureCard(db, 'kanji', key, 'meaning');
	applyReview(db, c.id, { correct: true, source: 'review', at } as never);
}

test('snapshot determinista: mismo contenido, mismo hash (también tras exportar e importar)', () => {
	const a = seededDb();
	review(a, '山', Date.now());
	const h = snapshotHash(buildSnapshot(a));
	expect(snapshotHash(buildSnapshot(a))).toBe(h);
	const b = seededDb();
	applySnapshot(b, buildSnapshot(a));
	expect(snapshotHash(buildSnapshot(b))).toBe(h);
});

// ---------- Protocolo completo ----------

function apiFor(db: DB): SyncApi {
	return {
		state: async (peerId) => stateFor(db, peerId),
		snapshot: async () => {
			const { zip, hash } = syncZip(db);
			return { bytes: zip, hash };
		},
		apply: async (bytes) => applySync(db, bytes),
		remember: async (p) => void upsertPeer(db, p),
		markSynced: async (id) => void markSynced(db, id, syncState(db).hash)
	};
}

function pipe(): [Transport, Transport] {
	const mk = (): Transport & { other?: Transport } => ({ onmessage: null, send() {}, close() {} });
	const x = mk();
	const y = mk();
	const deliver = (to: Transport, d: string | ArrayBuffer) => {
		setTimeout(() => to.onmessage?.(typeof d === 'string' ? d : d.slice(0)), 0);
	};
	x.send = (d) => deliver(y, d);
	y.send = (d) => deliver(x, d);
	return [x, y];
}

type Run = { a: SyncSession; b: SyncSession; sa: Status[]; sb: Status[] };
function connect(dbA: DB, dbB: DB, opts: { remember?: boolean; code?: [string, string] } = {}): Run {
	const [ta, tb] = pipe();
	const sa: Status[] = [];
	const sb: Status[] = [];
	const [ca, cb] = opts.code ?? ['4719', '4719'];
	const a = new SyncSession({ transport: ta, api: apiFor(dbA), initiator: true, name: 'PC', code: ca, binding: 'fp', remember: opts.remember ?? true, onStatus: (x) => sa.push(x) });
	const b = new SyncSession({ transport: tb, api: apiFor(dbB), initiator: false, name: 'Móvil', code: cb, binding: 'fp', remember: opts.remember ?? true, onStatus: (x) => sb.push(x) });
	return { a, b, sa, sb };
}

/** Responde automáticamente a «confirmar» y «elegir» como lo haría el usuario. */
function autopilot(r: Run, choose?: { who: 'a' | 'b'; keep: 'mine' | 'theirs' }) {
	const hook = (sess: SyncSession, list: Status[], who: 'a' | 'b') => {
		const push = list.push.bind(list);
		list.push = (...xs: Status[]) => {
			for (const x of xs) {
				if (x.step === 'confirm' && !x.waitingOther) setTimeout(() => void sess.confirm(true), 0);
				if (x.step === 'ask' && !x.waitingOther && choose?.who === who) setTimeout(() => void sess.choose(choose.keep), 0);
			}
			return push(...xs);
		};
	};
	hook(r.a, r.sa, 'a');
	hook(r.b, r.sb, 'b');
}

async function run(r: Run) {
	await Promise.all([r.a.start(), r.b.start()]);
	return Promise.all([r.a.done, r.b.done]);
}

const cards = (db: DB) => db.select().from(s.card).all().length;
const reviews = (db: DB) => db.select().from(s.reviewLog).all().length;

describe('protocolo entre dos dispositivos', () => {
	test('primera vez: código confirmado en ambos, el vacío recibe, y quedan recordados', async () => {
		const pc = seededDb();
		const phone = seededDb();
		review(pc, '山', Date.now() - 1000);
		review(pc, '川', Date.now());
		const r = connect(pc, phone);
		autopilot(r);
		const [da, db] = await run(r);
		expect(r.sa.some((x) => x.step === 'confirm')).toBe(true);
		expect(da).toMatchObject({ step: 'done', result: 'sent', remembered: true });
		expect(db).toMatchObject({ step: 'done', result: 'received', peerName: 'PC' });
		expect(cards(phone)).toBe(2);
		expect(reviews(phone)).toBe(2);
		// Ambos se recuerdan con la misma clave.
		expect(listPeers(pc)[0].key).toBe(listPeers(phone)[0].key);
		expect(listPeers(pc)[0].name).toBe('Móvil');
		// La copia previa del receptor existe (pre-sync), en el almacén por defecto.
		expect(r.sb.some((x) => x.step === 'transfer')).toBe(true);
	});

	test('recordados: sin código; solo cambió el móvil → el PC recibe; luego «ya estaban sincronizados»', async () => {
		const pc = seededDb();
		const phone = seededDb();
		review(pc, '山', Date.now() - 5000);
		let r = connect(pc, phone);
		autopilot(r);
		await run(r);

		review(phone, '川', Date.now());
		r = connect(pc, phone);
		autopilot(r);
		const [da, db] = await run(r);
		expect(r.sa.some((x) => x.step === 'confirm')).toBe(false); // autenticados por HMAC
		expect(da).toMatchObject({ result: 'received' });
		expect(db).toMatchObject({ result: 'sent' });
		expect(reviews(pc)).toBe(2);

		r = connect(pc, phone);
		autopilot(r);
		const [again] = await run(r);
		expect(again).toMatchObject({ result: 'same' });
	});

	test('ambos cambiaron: diálogo; elige el móvil «lo mío» y el PC recibe sus datos', async () => {
		const pc = seededDb();
		const phone = seededDb();
		review(pc, '山', Date.now() - 9000);
		let r = connect(pc, phone);
		autopilot(r);
		await run(r);
		review(pc, '川', Date.now() - 3000); // cambio en el PC
		db2Note(phone); // cambio distinto en el móvil

		r = connect(pc, phone);
		autopilot(r, { who: 'b', keep: 'mine' });
		const [da, db] = await run(r);
		expect(r.sa.some((x) => x.step === 'ask')).toBe(true);
		expect(da).toMatchObject({ result: 'received' });
		expect(db).toMatchObject({ result: 'sent' });
		expect(pc.select().from(s.learnerNote).all().map((n) => n.note)).toContain('nota del móvil');
		expect(reviews(pc)).toBe(1); // se quedó con lo del móvil (su repaso de 川 se descartó… y está en la copia pre-sync)
	});

	test('el usuario rechaza el código: ambos terminan en error y nada cambia', async () => {
		const pc = seededDb();
		const phone = seededDb();
		review(pc, '山', Date.now());
		const r = connect(pc, phone, { remember: false });
		const push = r.sb.push.bind(r.sb);
		r.sb.push = (...xs: Status[]) => {
			for (const x of xs) if (x.step === 'confirm') setTimeout(() => void r.b.confirm(false), 0);
			return push(...xs);
		};
		const [da, db] = await run(r);
		expect(db.step).toBe('error');
		expect(db).toMatchObject({ step: 'error', message: 'Cancelado: el código no coincidía' });
		expect(da).toMatchObject({ step: 'error', message: 'El otro dispositivo canceló: el código no coincidía' });
		expect(cards(phone)).toBe(0);
		expect(getPeer(pc, syncState(phone).deviceId)).toBeNull();
	});
});

function db2Note(db: DB) {
	db.insert(s.learnerNote).values({ note: 'nota del móvil', createdAt: Date.now() }).run();
}
