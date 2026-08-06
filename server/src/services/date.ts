/** Date helpers — local-time YYYY-MM-DD strings, identical to the mobile app. */

function toDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export function addDays(date: string, n: number): string {
  const d = toDate(date);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export function addMonths(date: string, n: number): string {
  const [y, m, day] = date.split('-').map(Number);
  const first = new Date(y, m - 1 + n, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const clamped = Math.min(day || 1, lastDay);
  return `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-${String(
    clamped,
  ).padStart(2, '0')}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
}

export function monthKey(date: string): string {
  return (date || '').slice(0, 7);
}

export function nowIso(): string {
  return new Date().toISOString();
}
