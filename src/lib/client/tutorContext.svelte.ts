// Estado global del tutor: panel lateral, contexto de la pantalla actual y preguntas iniciadas desde otras pantallas.
import type { ScreenContext } from '../types.ts';

export const tutor = $state({
	open: false,
	/** Lo que la pantalla actual ofrece como contexto. */
	context: null as ScreenContext | null,
	/** El alumno quitó el chip de este contexto (por etiqueta). */
	dismissed: null as string | null,
	/** Texto a precargar en el cuadro del panel. */
	draft: ''
});

/** Las páginas publican su contexto (p. ej. «kanji 末 · ficha»). Se borra al navegar (ver layout). */
export function setScreenContext(ctx: ScreenContext | null) {
	tutor.context = ctx;
	if (ctx?.label !== tutor.dismissed) tutor.dismissed = null;
}

/** Contexto que se adjuntará al próximo mensaje (null si el alumno lo quitó). */
export function activeContext(): ScreenContext | null {
	return tutor.context && tutor.context.label !== tutor.dismissed ? tutor.context : null;
}

export function dismissContext() {
	tutor.dismissed = tutor.context?.label ?? null;
}

/** Abre el panel con un contexto concreto y, opcionalmente, una pregunta precargada. */
export function askTutor(ctx: ScreenContext | null, draft = '') {
	if (ctx) setScreenContext(ctx);
	tutor.draft = draft;
	tutor.open = true;
}
