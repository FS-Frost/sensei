import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Base del sitio: '' en local; en GitHub Pages, '/<repo>' (lo pone el CI con BASE_PATH).
const base = (process.env.BASE_PATH ?? '') as '' | `/${string}`;
const shim = (f: string) => fileURLToPath(new URL(`./src/lib/server/shims/${f}`, import.meta.url));

// Sustitutos de módulos de Node para el navegador (en Bun/tests se usan los reales).
const alias = {
	'node:async_hooks': shim('async_hooks.ts'),
	'@open-spaced-repetition/binding': shim('fsrs-binding.ts')
};

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
			},
			// SPA: 404.html sirve cualquier ruta profunda en GitHub Pages.
			adapter: adapter({ pages: 'build', assets: 'build', fallback: '404.html', precompress: false, strict: false }),
			paths: { base, relative: false },
			// Se registra a mano solo en build (client/pwa.ts).
			serviceWorker: { register: false }
		})
	],
	resolve: { alias },
	worker: { format: 'es' },
	server: { port: Number(process.env.PORT ?? 5173), strictPort: true },
	// sqlite-wasm carga su .wasm por URL relativa: no debe pre-empaquetarse.
	optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm', 'fsrs-browser'] }
});
