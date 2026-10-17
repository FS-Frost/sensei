// Señas WebRTC compactas (~120 caracteres) para emparejar por sonido (ggwave: ≤140 bytes) o por QR pequeño.
// Se EXTRAEN campos del SDP local (sin modificarlo) y el otro lado RECONSTRUYE el SDP remoto con una plantilla
// fija de canal de datos. Solo se transmite un candidato «host» UDP: la conexión es por la red local.
//
// Formato: S2~<rol><mid>~<ufrag>~<pwd>~<huella>~<dirección>~<puerto>~<caduca>
//   rol: o = oferta (setup actpass) · a = respuesta active · p = respuesta passive
//   pwd/ufrag hexadecimales largos (Firefox) → «.» + base64url; nombre mDNS (uuid.local) → «.» + base64url.

export type Role = 'o' | 'a' | 'p';
export type Signal = {
	role: Role;
	mid: string;
	ufrag: string;
	pwd: string;
	/** SHA-256 de la huella DTLS, 32 bytes. */
	fingerprint: Uint8Array;
	address: string;
	port: number;
	/** Epoch en segundos. */
	expires: number;
};

export const PREFIX = 'S2';

const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => {
	const t = s.replace(/-/g, '+').replace(/_/g, '/');
	return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
};
const hexToBytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const bytesToHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// Marca de «comprimido»: «.», que no es un carácter ICE válido (ALPHA / DIGIT / "+" / "/") ni empieza una IP.

/** Hexadecimal largo y par (Firefox) → «.» + base64url (más corto); si no, tal cual. */
function packToken(s: string) {
	return s.length >= 16 && s.length % 2 === 0 && /^[0-9a-f]+$/.test(s) ? '.' + b64u(hexToBytes(s)) : s;
}
function unpackToken(s: string) {
	return s.startsWith('.') ? bytesToHex(unb64u(s.slice(1))) : s;
}

const MDNS = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;
function packAddress(a: string) {
	const m = a.match(MDNS);
	return m ? '.' + b64u(hexToBytes(m.slice(1).join('').toLowerCase())) : a;
}
function unpackAddress(a: string) {
	if (!a.startsWith('.')) return a;
	const h = bytesToHex(unb64u(a.slice(1)));
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`;
}

/** Elige el candidato local: UDP «host», prefiriendo IPv4, luego mDNS, luego IPv6. */
export function pickCandidate(sdp: string): { address: string; port: number } | null {
	const cands = [...sdp.matchAll(/^a=candidate:\S+ \d+ (\S+) \d+ (\S+) (\d+) typ (\S+)/gim)]
		.filter((m) => m[1].toLowerCase() === 'udp' && m[4] === 'host')
		.map((m) => ({ address: m[2], port: Number(m[3]) }));
	const rank = (a: string) => (/^\d+\.\d+\.\d+\.\d+$/.test(a) ? 0 : MDNS.test(a) ? 1 : 2);
	return cands.sort((x, y) => rank(x.address) - rank(y.address))[0] ?? null;
}

/** Extrae las señas de una descripción local completa (tras reunir candidatos). */
export function fromSdp(sdp: string, type: 'offer' | 'answer', ttlSeconds = 300, now = Date.now()): Signal {
	const get = (re: RegExp) => sdp.match(re)?.[1]?.trim();
	const ufrag = get(/^a=ice-ufrag:(.+)$/m);
	const pwd = get(/^a=ice-pwd:(.+)$/m);
	const fp = get(/^a=fingerprint:sha-256 (.+)$/im);
	const mid = get(/^a=mid:(.+)$/m) ?? '0';
	const setup = get(/^a=setup:(.+)$/m);
	const cand = pickCandidate(sdp);
	if (!ufrag || !pwd || !fp) throw new Error('SDP incompleto (faltan credenciales ICE o huella DTLS)');
	if (!cand) throw new Error('No hay dirección en la red local (¿estás conectado a una WiFi?)');
	const role: Role = type === 'offer' ? 'o' : setup === 'passive' ? 'p' : 'a';
	return {
		role,
		mid,
		ufrag,
		pwd,
		fingerprint: hexToBytes(fp.replace(/:/g, '')),
		address: cand.address,
		port: cand.port,
		expires: Math.floor(now / 1000) + ttlSeconds
	};
}

export function encode(s: Signal): string {
	return [PREFIX, s.role + (s.mid === '0' ? '' : s.mid), packToken(s.ufrag), packToken(s.pwd), b64u(s.fingerprint), packAddress(s.address), s.port, s.expires.toString(36)].join('~');
}

export function decode(text: string): Signal {
	const parts = text.trim().split('~');
	if (parts.length !== 8 || parts[0] !== PREFIX) throw new Error('Este código no es de Sensei (o es de otra versión)');
	const [, rm, ufrag, pwd, fp, addr, port, exp] = parts;
	const role = rm[0] as Role;
	if (!['o', 'a', 'p'].includes(role)) throw new Error('Código dañado');
	const fingerprint = unb64u(fp);
	if (fingerprint.length !== 32) throw new Error('Código dañado (huella)');
	return {
		role,
		mid: rm.slice(1) || '0',
		ufrag: unpackToken(ufrag),
		pwd: unpackToken(pwd),
		fingerprint,
		address: unpackAddress(addr),
		port: Number(port),
		expires: parseInt(exp, 36)
	};
}

export function isExpired(s: Signal, now = Date.now()) {
	return s.expires * 1000 < now;
}

export function fingerprintHex(fp: Uint8Array) {
	return bytesToHex(fp).toUpperCase().match(/../g)!.join(':');
}

/** SDP remoto de canal de datos a partir de las señas del otro lado. */
export function toSdp(s: Signal): { type: 'offer' | 'answer'; sdp: string } {
	const setup = s.role === 'o' ? 'actpass' : s.role === 'p' ? 'passive' : 'active';
	const ipv = s.address.includes(':') && !s.address.endsWith('.local') ? 'IP6' : 'IP4';
	const lines = [
		'v=0',
		'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
		's=-',
		't=0 0',
		`a=group:BUNDLE ${s.mid}`,
		'a=msid-semantic: WMS',
		`m=application ${s.port} UDP/DTLS/SCTP webrtc-datachannel`,
		`c=IN ${ipv} ${ipv === 'IP6' ? '::' : '0.0.0.0'}`,
		`a=candidate:1 1 udp 2113937151 ${s.address} ${s.port} typ host generation 0`,
		'a=end-of-candidates',
		`a=ice-ufrag:${s.ufrag}`,
		`a=ice-pwd:${s.pwd}`,
		`a=fingerprint:sha-256 ${fingerprintHex(s.fingerprint)}`,
		`a=setup:${setup}`,
		`a=mid:${s.mid}`,
		'a=sctp-port:5000',
		'a=max-message-size:262144'
	];
	return { type: s.role === 'o' ? 'offer' : 'answer', sdp: lines.join('\r\n') + '\r\n' };
}

/** Código de confirmación de 4 dígitos, igual en ambos lados: depende de las dos huellas DTLS de ESTA conexión. */
export async function confirmationCode(a: Uint8Array, b: Uint8Array) {
	const [x, y] = [b64u(a), b64u(b)].sort();
	const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`sensei-sas|${x}|${y}`)));
	const n = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
	return String(n % 10000).padStart(4, '0');
}
