import { error, type ServerLoadEvent } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { getComponentInfo, getKanjiInfo, similarTo } from '#lib/server/items.ts';

export const load = ({ params }: ServerLoadEvent) => {
	const kanji = getKanjiInfo(db, params.char, { vocabLimit: 12 });
	if (kanji) return { kanji, component: null, similar: similarTo(db, kanji.char, { limit: 6 }) };
	const component = getComponentInfo(db, params.char);
	if (component) return { kanji: null, component, similar: [] };
	error(404, `No hay datos de «${params.char}»`);
};
