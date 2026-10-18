// Ayudas para tests: un alumno que ya sabe kana (si no, las lecciones empiezan por el curso de kana y los kanji esperan).
import type { DB } from '../src/lib/server/db/bun.ts';
import { COURSE_KANA } from '../src/lib/kanaCourse.ts';
import { knownCard } from '../src/lib/server/kana.ts';

export function knowAllKana(db: DB) {
	for (const k of COURSE_KANA) knownCard(db, 'kana', k, 'reading', 'diagnostic');
}
