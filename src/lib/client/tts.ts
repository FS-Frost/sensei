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
