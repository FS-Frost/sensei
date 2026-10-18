// Secretos dentro de una exportación (hoy: la API key de Gemini), cifrados con una contraseña del alumno.
// WebCrypto (Worker, navegador y Bun): PBKDF2-SHA256 deriva la clave, AES-GCM cifra y autentica.
// Sin la contraseña el .zip no sirve para gastar en la cuenta de Gemini de nadie.

export type SealedSecret = {
	v: 1;
	kdf: 'PBKDF2-SHA256';
	iterations: number;
	/** base64 */
	salt: string;
	iv: string;
	data: string;
};

export class SecretError extends Error {}

export const MIN_PASSWORD = 8;
const ITERATIONS = 600_000;

const b64 = (bytes: Uint8Array) => {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
	const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', hash: 'SHA-256', salt: salt as Uint8Array<ArrayBuffer>, iterations },
		base,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

export async function sealSecret(text: string, password: string): Promise<SealedSecret> {
	if (password.length < MIN_PASSWORD) throw new SecretError(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`);
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await deriveKey(password, salt, ITERATIONS);
	const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
	return { v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(data) };
}

export async function openSecret(sealed: SealedSecret, password: string): Promise<string> {
	if (sealed?.v !== 1 || sealed.kdf !== 'PBKDF2-SHA256') throw new SecretError('Formato de secreto no soportado');
	// Tope defensivo: un archivo manipulado no debe bloquear la app con millones de iteraciones.
	if (!(sealed.iterations >= 100_000 && sealed.iterations <= 5_000_000)) throw new SecretError('Secreto dañado');
	try {
		const key = await deriveKey(password, unb64(sealed.salt), sealed.iterations);
		const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) as Uint8Array<ArrayBuffer> }, key, unb64(sealed.data) as Uint8Array<ArrayBuffer>);
		return new TextDecoder().decode(plain);
	} catch {
		throw new SecretError('Contraseña incorrecta (o el archivo está dañado)');
	}
}
