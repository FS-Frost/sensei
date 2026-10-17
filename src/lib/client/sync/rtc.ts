// WebRTC solo por la red local (sin STUN/TURN): crear oferta/respuesta, reunir candidatos «host», conectar
// con las señas compactas del otro lado y exponer el canal de datos como `Transport` para protocol.ts.
import { confirmationCode, decode, encode, fromSdp, isExpired, toSdp, type Signal } from './signal.ts';
import type { Transport } from './protocol.ts';

const CHANNEL = 'sensei-sync';
const MAX_BUFFER = 1024 * 1024;

function waitGathering(pc: RTCPeerConnection, ms = 3000) {
	if (pc.iceGatheringState === 'complete') return Promise.resolve();
	return new Promise<void>((resolve) => {
		const done = () => {
			pc.removeEventListener('icegatheringstatechange', check);
			clearTimeout(t);
			resolve();
		};
		const check = () => pc.iceGatheringState === 'complete' && done();
		const t = setTimeout(done, ms); // basta con el primer candidato local
		pc.addEventListener('icegatheringstatechange', check);
	});
}

function waitOpen(ch: RTCDataChannel, pc: RTCPeerConnection, ms = 20000) {
	return new Promise<void>((resolve, reject) => {
		if (ch.readyState === 'open') return resolve();
		const t = setTimeout(() => reject(new Error('No se pudo conectar por la red local. ¿Están en la misma WiFi (sin aislamiento de clientes)?')), ms);
		ch.onopen = () => {
			clearTimeout(t);
			resolve();
		};
		pc.onconnectionstatechange = () => {
			if (pc.connectionState === 'failed') {
				clearTimeout(t);
				reject(new Error('La conexión por la red local falló. Comprueba que ambos estén en la misma red.'));
			}
		};
	});
}

/** Canal de datos → Transport (con control de flujo para los trozos grandes). */
export function channelTransport(ch: RTCDataChannel): Transport {
	ch.binaryType = 'arraybuffer';
	const t: Transport = {
		onmessage: null,
		async send(data) {
			while (ch.bufferedAmount > MAX_BUFFER) await new Promise((r) => setTimeout(r, 20));
			if (typeof data === 'string') ch.send(data);
			else ch.send(data);
		},
		close: () => ch.close()
	};
	ch.onmessage = (e) => t.onmessage?.(e.data as string | ArrayBuffer);
	return t;
}

/** Resultado del emparejamiento: canal abierto + código de confirmación de esta conexión. */
export type Connected = { channel: RTCDataChannel; pc: RTCPeerConnection; initiator: boolean; code: string; binding: string };

export type Link = {
	pc: RTCPeerConnection;
	/** Mis señas compactas (para emitir por sonido o mostrar en QR). */
	signal: string;
	mine: Signal;
};

function newPc() {
	// Sin servidores ICE: solo candidatos de la red local.
	return new RTCPeerConnection({ iceServers: [] });
}

/** Lado que inicia: crea la oferta. Después `connectAnswer` con la respuesta del otro. */
export async function createOffer(): Promise<Link & { channel: RTCDataChannel }> {
	const pc = newPc();
	const channel = pc.createDataChannel(CHANNEL, { ordered: true });
	await pc.setLocalDescription(await pc.createOffer());
	await waitGathering(pc);
	const mine = fromSdp(pc.localDescription!.sdp, 'offer');
	return { pc, channel, mine, signal: encode(mine) };
}

export async function connectAnswer(link: Link & { channel: RTCDataChannel }, answerText: string) {
	const theirs = decode(answerText);
	if (theirs.role === 'o') throw new Error('Ese código es una oferta, no una respuesta: el otro dispositivo debe pulsar «Unirme»');
	if (isExpired(theirs)) throw new Error('La respuesta caducó: empieza de nuevo');
	await link.pc.setRemoteDescription(toSdp(theirs));
	await waitOpen(link.channel, link.pc);
	return { channel: link.channel, theirs };
}

/** Lado que se une: recibe la oferta y crea la respuesta. El canal llega cuando el iniciador conecta. */
export async function acceptOffer(offerText: string) {
	const theirs = decode(offerText);
	if (theirs.role !== 'o') throw new Error('Ese código es una respuesta: en este dispositivo pulsa «Iniciar» o escanea la oferta del otro');
	if (isExpired(theirs)) throw new Error('El código caducó (dura 5 minutos): genera uno nuevo en el otro dispositivo');
	const pc = newPc();
	const channelReady = new Promise<RTCDataChannel>((resolve) => (pc.ondatachannel = (e) => resolve(e.channel)));
	await pc.setRemoteDescription(toSdp(theirs));
	await pc.setLocalDescription(await pc.createAnswer());
	await waitGathering(pc);
	const mine = fromSdp(pc.localDescription!.sdp, 'answer');
	return {
		pc,
		mine,
		theirs,
		signal: encode(mine),
		async channel() {
			const ch = await Promise.race([
				channelReady,
				new Promise<never>((_, rej) => setTimeout(() => rej(new Error('El otro dispositivo no se conectó: ¿recibió tu respuesta?')), 120000))
			]);
			await waitOpen(ch, pc);
			return ch;
		}
	};
}

export function codeFor(mine: Signal, theirs: Signal) {
	return confirmationCode(mine.fingerprint, theirs.fingerprint);
}

/** Material que ata la autenticación HMAC a esta conexión concreta. */
export function bindingFor(mine: Signal, theirs: Signal) {
	const h = (s: Signal) => [...s.fingerprint].map((b) => b.toString(16).padStart(2, '0')).join('');
	return [h(mine), h(theirs)].sort().join('|');
}

/** «Edge · Windows», «Chrome · Android»… para nombrar el dispositivo. */
export function deviceName() {
	const ua = navigator.userAgent;
	const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
	const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
	return os ? `${browser} · ${os}` : browser;
}
