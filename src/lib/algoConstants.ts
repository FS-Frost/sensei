// Constantes de los algoritmos que también se explican en la Guía («Cómo funciona por dentro»): una sola fuente para el
// código y para la explicación. Sin dependencias (lo importan cliente y servidor).

/** Estabilidad (días) a partir de la que un ítem cuenta como «dominado». */
export const MASTERED_DAYS = 21;
/** Estabilidad (días) de la lectura a partir de la que se oculta la furigana (o el romaji de apoyo de un kana). */
export const READABLE_DAYS = 7;
/** Diagnóstico de kana: más lento que esto (ms) cuenta como dudoso aunque sea correcto. */
export const KANA_SLOW_MS = 4000;
/** Diagnóstico de kana: fallos en la muestra con los que esa escritura se aprende desde cero. */
export const KANA_SAMPLE_FAILS = 6;
/** Test de nivel: aciertos de 5 para aprobar una franja. */
export const PLACEMENT_PASS = 4;
/** Veces que hay que confundir un par para proponer un ejercicio de discriminación. */
export const CONFUSION_HINT = 3;
