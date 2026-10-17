import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { applyReset, GROUP_TYPES, isEmptyRequest, previewReset, type ResetRequest } from '#lib/server/data/reset.ts';
import { createBackup } from '#lib/server/data/backups.ts';
import type { ItemType } from '#lib/types.ts';

const TYPES: ItemType[] = ['kana', 'component', 'kanji', 'vocab', 'grammar', 'sentence'];

function validate(req: ResetRequest): ResetRequest {
	const out: ResetRequest = { tutor: !!req.tutor, generated: !!req.generated, library: !!req.library, usage: !!req.usage };
	if (req.progress === 'all') out.progress = 'all';
	else if (Array.isArray(req.progress)) out.progress = req.progress.filter((g) => g in GROUP_TYPES);
	if (req.item) {
		if (!TYPES.includes(req.item.type) || typeof req.item.key !== 'string' || !req.item.key)
			throw new HttpError(400, 'Ítem inválido');
		out.item = { type: req.item.type, key: req.item.key };
	}
	if (isEmptyRequest(out)) throw new HttpError(400, 'No hay nada que reiniciar');
	return out;
}

/** `{ ...ResetRequest, dry?: true }`. Sin `dry`, crea una copia «pre-reset» y aplica. */
export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		const raw = await body<ResetRequest & { dry?: boolean }>(request);
		const req = validate(raw);
		const preview = previewReset(db, req);
		if (raw.dry) return Response.json({ preview });
		const backup = await createBackup(db, 'pre-reset');
		applyReset(db, req);
		return Response.json({ preview, backup: backup.name });
	});
