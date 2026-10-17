import { unzipSync, strFromU8 } from 'fflate';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const RELEASES = 'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest';

export const RAW_DIR = 'data/raw';

export type AssetName =
	| 'kanjidic2-all'
	| 'kradfile'
	| 'radkfile'
	| 'jmdict-eng'
	| 'jmdict-eng-common'
	| 'jmdict-spa'
	| 'jmdict-examples-eng';

type Release = { tag_name: string; assets: { name: string; browser_download_url: string }[] };

let release: Release | null = null;

async function latestRelease(): Promise<Release> {
	if (release) return release;
	// En CI, con token: la API sin autenticar limita a 60 peticiones/hora por IP (compartida entre runners).
	const token = process.env.GITHUB_TOKEN;
	const res = await fetch(RELEASES, {
		headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
	});
	if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
	release = (await res.json()) as Release;
	return release;
}

/** Descarga (con caché en data/raw) un asset .json.zip de jmdict-simplified y devuelve el JSON parseado. */
export async function loadAsset<T>(name: AssetName, log = console.log): Promise<T> {
	mkdirSync(RAW_DIR, { recursive: true });
	const cached = join(RAW_DIR, `${name}.json.zip`);
	if (!existsSync(cached)) {
		const rel = await latestRelease();
		// "<name>-<versión numérica>.json.zip" (evita que "jmdict-eng" matchee "jmdict-eng-common").
		const re = new RegExp(`^${name}-\\d[^/]*\\.json\\.zip$`);
		const chosen = rel.assets.find((a) => re.test(a.name));
		if (!chosen) throw new Error(`Asset ${name} no encontrado en ${rel.tag_name}`);
		log(`  ↓ ${chosen.name}`);
		const res = await fetch(chosen.browser_download_url);
		if (!res.ok) throw new Error(`Descarga ${chosen.name}: ${res.status}`);
		await Bun.write(cached, await res.arrayBuffer());
	}
	const zipped = new Uint8Array(await Bun.file(cached).arrayBuffer());
	const files = unzipSync(zipped);
	const entry = Object.keys(files).find((f) => f.endsWith('.json'));
	if (!entry) throw new Error(`${cached} no contiene JSON`);
	return JSON.parse(strFromU8(files[entry])) as T;
}
