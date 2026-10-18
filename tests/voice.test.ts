// Voz: WAV correcto, diezmado, recorte de silencio, detector de fin de frase, «[Oído: …]» y lectura por idioma.
import { expect, test } from 'bun:test';
import { downsample, encodeWav, SilenceDetector, toBase64, trimSilence, TARGET_RATE } from '../src/lib/client/voice-core.ts';
import { splitByLanguage } from '../src/lib/client/tts.ts';
import { splitHeard } from '../src/lib/server/gemini/tutor.ts';

test('WAV PCM 16 bits mono a 16 kHz', () => {
	const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1]));
	const v = new DataView(wav.buffer);
	expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
	expect(String.fromCharCode(...wav.subarray(8, 12))).toBe('WAVE');
	expect(v.getUint16(22, true)).toBe(1);
	expect(v.getUint32(24, true)).toBe(TARGET_RATE);
	expect(v.getUint32(40, true)).toBe(10);
	expect(v.getInt16(44 + 3 * 2, true)).toBe(32767);
	expect(v.getInt16(44 + 4 * 2, true)).toBe(-32768);
	expect(toBase64(wav).length).toBe(Math.ceil(wav.length / 3) * 4);
});

test('diezmado 48 → 16 kHz y recorte de silencio', () => {
	expect(downsample(new Float32Array(48000), 48000)).toHaveLength(16000);
	const x = new Float32Array(TARGET_RATE * 3);
	for (let i = TARGET_RATE; i < TARGET_RATE * 2; i++) x[i] = Math.sin(i / 5) * 0.5; // 1 s de «voz» en medio
	const t = trimSilence(x);
	expect(t.length).toBeGreaterThan(TARGET_RATE);
	expect(t.length).toBeLessThan(TARGET_RATE * 1.5);
});

test('fin de frase: solo tras haber hablado, y tras el silencio configurado', () => {
	const d = new SilenceDetector(1000, 0.05);
	expect(d.push(0, 0)).toBe(false); // silencio inicial: aún no habló
	expect(d.push(0, 5000)).toBe(false);
	expect(d.push(0.2, 5100)).toBe(false); // habla
	expect(d.push(0.01, 5200)).toBe(false);
	expect(d.push(0.01, 6100)).toBe(false);
	expect(d.push(0.01, 6250)).toBe(true);
});

test('«[Oído: …]» se separa de la respuesta del tutor', () => {
	expect(splitHeard('[Oído: «¿cómo se lee 曖昧?»]\n曖昧 se lee あいまい.')).toEqual({ transcript: '¿cómo se lee 曖昧?', rest: '曖昧 se lee あいまい.' });
	expect(splitHeard('Hola, ¿qué tal?')).toBeNull();
});

test('lectura en voz alta: tramos por idioma, sin Markdown y con la lectura de la furigana', () => {
	const parts = splitByLanguage('La palabra **{山|やま}** significa «montaña». Por ejemplo: {富士山|ふじさん}に{登|のぼ}る。');
	expect(parts.map((p) => p.lang)).toEqual(['es', 'ja', 'es', 'ja']);
	expect(parts[1].text).toBe('やま');
	expect(parts[3].text).toContain('ふじさんにのぼる');
});
