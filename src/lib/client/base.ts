// Base del sitio sin barra final: '' en local, '/<repo>' en GitHub Pages (kit paths.base → Vite base).
// Kit 3 ya no exporta `base` en $app/paths.
export const base = import.meta.env.BASE_URL.replace(/\/$/, '');
