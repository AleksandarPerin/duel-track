// Tiebreakers (OMW/GW/OGW) are stored fractions — pg NUMERIC, so they reach
// the client as strings like "0.3300" — and the server never scales them.
export function formatPercent(v: number | string | null | undefined): string {
  return v != null ? `${(Number(v) * 100).toFixed(2)}%` : '—';
}
