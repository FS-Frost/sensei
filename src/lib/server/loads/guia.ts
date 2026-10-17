import { db } from '#lib/server/db/index.ts';
import { journey } from '#lib/server/guide.ts';
import { BRAKE_HALF, BRAKE_STOP } from '#lib/server/srs/lessons.ts';
import { RETENTION_DAYS } from '#lib/server/data/backups.ts';

export const load = () => ({
	journey: journey(db),
	brake: { half: BRAKE_HALF, stop: BRAKE_STOP },
	retentionDays: RETENTION_DAYS
});
