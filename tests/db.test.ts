import { expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { one } from '../src/lib/server/db/index.ts';
import { openDb } from '../src/lib/server/db/bun.ts';
import * as s from '../src/lib/server/db/schema.ts';

test('one() devuelve la fila como objeto (db.get de bun-sqlite devuelve un array)', () => {
	const db = openDb(':memory:').db;
	db.insert(s.kanji).values({ char: '日' }).run();
	expect(one<{ n: number }>(sql`select count(*) as n from kanji`, db)).toEqual({ n: 1 });
	expect(one<{ n: number }>(sql`select 1 as n where 0`, db)).toBeUndefined();
});
