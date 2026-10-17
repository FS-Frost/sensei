// goto() que acepta rutas absolutas de la app («/tutor») y les antepone la base del sitio (GitHub Pages).
import { goto as kitGoto } from '$app/navigation';
import { withBase } from './basePath.ts';

export function goto(path: string, opts?: Parameters<typeof kitGoto>[1]) {
	return kitGoto(withBase(path), opts);
}
