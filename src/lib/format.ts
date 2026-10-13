export const money = (n: number | string | null | undefined) =>
  '$' + Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money0 = (n: number | string | null | undefined) =>
  '$' + Math.round(Number(n ?? 0)).toLocaleString('en-US');
export const num = (n: number | string | null | undefined) => Math.round(Number(n ?? 0)).toLocaleString('en-US');
export const sum = <T,>(xs: T[], f: (x: T) => number | string) => xs.reduce((s, x) => s + Number(f(x)), 0);

export function dateLabel(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('en-US', opts);
}
export const longDate = (iso: string | null | undefined) =>
  dateLabel(iso, { month: 'short', day: 'numeric', year: 'numeric' });
export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}
