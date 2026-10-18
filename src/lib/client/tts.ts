// TTS del navegador (Web Speech API) con voz ja-JP. Gratis y sin conexión si el sistema tiene la voz instalada.

const VOICE_KEY = 'sensei.ttsVoice';

export function ttsSupported() {
	return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function japaneseVoices(): SpeechSynthesisVoice[] {
	if (!ttsSupported()) return [];
	return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('ja'));
}

export function preferredVoiceName(): string | null {
	return typeof localStorage === 'undefined' ? null : localStorage.getItem(VOICE_KEY);
}

export function setPreferredVoice(name: string) {
	localStorage.setItem(VOICE_KEY, name);
}

/** Quita la notación {漢字|かんじ} y deja la lectura, que el TTS pronuncia sin ambigüedad. */
function plain(text: string) {
	return text.replace(/\{([^|{}]+)\|([^{}]+)\}/g, '$2');
}

// ---------- Respuestas del tutor en voz alta (español + japonés) ----------

const JP = /[぀-ヿ㐀-鿿ー々〜]/;

/**
 * Trocea un texto mixto en tramos de un solo idioma. Quita Markdown y deja la lectura de la furigana: así el
 * japonés suena con su voz japonesa y el español con la española.
 */
export function splitByLanguage(text: string): { lang: 'ja' | 'es'; text: string }[] {
	const clean = plain(text)
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/[*_`#>|]+/g, ' ')
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();
	const out: { lang: 'ja' | 'es'; text: string }[] = [];
	let cur = '';
	let lang: 'ja' | 'es' | null = null;
	for (const ch of clean) {
		// Signos y espacios no cambian de idioma: se pegan al tramo en curso.
		const l: 'ja' | 'es' | null = JP.test(ch) ? 'ja' : /[\p{L}\p{N}]/u.test(ch) ? 'es' : null;
		if (l && lang && l !== lang) {
			if (cur.trim()) out.push({ lang, text: cur.trim() });
			cur = '';
		}
		if (l) lang = l;
		cur += ch;
	}
	if (cur.trim() && lang) out.push({ lang, text: cur.trim() });
	// Tramos japoneses de un solo signo suelto dentro de español no merecen cambiar de voz.
	return out.filter((t) => t.text.replace(/[\s、。・「」（）!?¡¿.,;:]/g, ''));
}

function voiceFor(lang: 'ja' | 'es') {
	if (lang === 'ja') {
		const voices = japaneseVoices();
		const pref = preferredVoiceName();
		return voices.find((v) => v.name === pref) ?? voices[0] ?? null;
	}
	const es = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('es'));
	return es.find((v) => /es-(es|mx|us|419)/i.test(v.lang)) ?? es[0] ?? null;
}

/** Lee en voz alta un texto mixto; se resuelve al terminar (o al cancelarlo). */
export function speakMixed(text: string, rate = 1): Promise<void> {
	if (!ttsSupported()) return Promise.resolve();
	speechSynthesis.cancel();
	const parts = splitByLanguage(text);
	if (!parts.length) return Promise.resolve();
	return new Promise((resolve) => {
		parts.forEach((p, i) => {
			const u = new SpeechSynthesisUtterance(p.text);
			u.lang = p.lang === 'ja' ? 'ja-JP' : 'es-ES';
			u.voice = voiceFor(p.lang);
			u.rate = p.lang === 'ja' ? rate * 0.9 : rate;
			if (i === parts.length - 1) {
				u.onend = () => resolve();
				u.onerror = () => resolve();
			}
			speechSynthesis.speak(u);
		});
	});
}

export function stopSpeaking() {
	if (ttsSupported()) speechSynthesis.cancel();
}

export function speak(text: string, rate = 0.9) {
	if (!ttsSupported() || !text.trim()) return;
	speechSynthesis.cancel();
	const u = new SpeechSynthesisUtterance(plain(text));
	u.lang = 'ja-JP';
	u.rate = rate;
	const voices = japaneseVoices();
	const pref = preferredVoiceName();
	u.voice = voices.find((v) => v.name === pref) ?? voices[0] ?? null;
	speechSynthesis.speak(u);
}
