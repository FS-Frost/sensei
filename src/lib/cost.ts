// Formato de costos en USD (cliente y servidor).

export type OperationCost = { usd: number; calls: number; unpriced: boolean };

/** $1.23 · $0.042 · $0.0031 · $0 — más decimales cuanto más pequeño, para que no todo sea «$0.00». */
export function fmtUsd(usd: number | null | undefined): string {
	if (usd == null) return '—';
	const a = Math.abs(usd);
	if (a === 0) return '$0';
	if (a >= 10) return `$${usd.toFixed(2)}`;
	if (a >= 0.1) return `$${usd.toFixed(3)}`;
	if (a >= 0.001) return `$${usd.toFixed(4)}`;
	return `$${usd.toFixed(5)}`;
}

/** Precio por 1M de tokens: $2.00 · $0.10 · $0.075 (centavos salvo que haga falta un decimal más). */
export function fmtPrice(usd: number): string {
	const cents = Math.round(usd * 100) / 100;
	return Math.abs(usd - cents) > 1e-9 ? `$${+usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

export function fmtTokens(n: number): string {
	if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} M`;
	if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)} k`;
	return String(n);
}
