// Perfiles de modelos de Gemini (Ajustes → Modelos). Solo modelos estables: los «preview» pueden cerrarse con poco aviso.
// Rol «pro»: tutor, lecturas, explicador, mnemotecnias. Rol «flash»: resúmenes, informe, glosas, frases, «¿por qué?».
// Precios en server/gemini/pricing.ts (revisados el 2026-10-18).

export type PresetId = 'ahorro' | 'equilibrado' | 'maximo';

export type ModelPreset = { id: PresetId; icon: string; label: string; pro: string; flash: string; desc: string };

export const PRESETS: ModelPreset[] = [
	{
		id: 'ahorro',
		icon: '🌱',
		label: 'Ahorro',
		pro: 'gemini-3.5-flash-lite',
		flash: 'gemini-3.1-flash-lite',
		desc: 'Lo más barato. Puede fallar más en matices de gramática (las lecturas se siguen validando con el diccionario).'
	},
	{
		id: 'equilibrado',
		icon: '⚖',
		label: 'Equilibrado',
		pro: 'gemini-3.8-flash',
		flash: 'gemini-3.5-flash-lite',
		desc: 'Recomendado: el Flash más capaz para el tutor y Flash-Lite para las tareas cortas.'
	},
	{
		id: 'maximo',
		icon: '🎓',
		label: 'Máximo',
		pro: 'gemini-4-argon',
		flash: 'gemini-3.8-flash',
		desc: 'La mejor calidad en el tutor y las explicaciones, varias veces más caro.'
	}
];

export const DEFAULT_PRESET: PresetId = 'equilibrado';
export const DEFAULT_MODELS = PRESETS.find((p) => p.id === DEFAULT_PRESET)!;

/** Perfil que corresponde a los modelos efectivos, o 'custom' si no coincide con ninguno. */
export function presetOf(pro: string, flash: string): PresetId | 'custom' {
	return PRESETS.find((p) => p.pro === pro && p.flash === flash)?.id ?? 'custom';
}
