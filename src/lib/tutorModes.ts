import type { ChatMode } from './types.ts';

export const MODE_LABEL: Record<ChatMode, string> = {
	conversacion: 'Conversación-quiz',
	quiz: 'Quiz a medida',
	explicador: 'Explicador',
	confusiones: 'Detective de confusiones',
	libre: 'Libre',
	cierre: 'Cierre del día'
};

/** Modos que se eligen en /tutor (el cierre solo se abre desde la sesión diaria). */
export const LISTED_MODES = ['conversacion', 'quiz', 'explicador', 'confusiones', 'libre'] as const satisfies readonly ChatMode[];

export const MODE_DESC: Record<ChatMode, string> = {
	conversacion: 'El tutor te hace preguntas por turnos y se adapta a tu nivel.',
	quiz: 'Pide un quiz sobre lo que quieras: un radical, un tema, tus kanji débiles…',
	explicador: 'Pega frases de manga, juegos o carteles y las desglosa contigo.',
	confusiones: 'Ejercicios para separar los pares que confundes.',
	libre: 'Cualquier cosa: dudas, tu plan, tu biblioteca, añadir cosas a tus lecciones…',
	cierre: 'El tutor comenta contigo lo de hoy y qué viene mañana.'
};

export const SUGGEST: Record<ChatMode, string[]> = {
	conversacion: ['¡Empecemos!', 'Pregúntame por mis kanji débiles', 'Hazme leer frases cortas'],
	quiz: ['Quiz de 8 preguntas con mis kanji', 'Quiz de vocabulario de comida', 'Quiz de lecturas on vs kun'],
	explicador: ['¿Qué significa 「お前はもう死んでいる」?', 'Explícame la diferencia entre は y が con ejemplos'],
	confusiones: ['Analiza mis confusiones', 'Ejercicios con 土/士 y 未/末'],
	libre: ['¿Qué me toca hoy y por qué?', '¿Cómo voy con mi objetivo?', 'Enséñame a leer las fechas'],
	cierre: ['¿Cómo me fue hoy?', 'Cierra mi día y dime qué repasar mañana']
};

export function isMode(x: unknown): x is ChatMode {
	return typeof x === 'string' && x in MODE_LABEL;
}
