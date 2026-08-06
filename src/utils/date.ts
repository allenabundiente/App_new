/** Date helpers — all operate on local-time YYYY-MM-DD strings. Pure + tested. */

function toDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Today as YYYY-MM-DD in local time. */
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

/** Add months, clamping day-of-month to the target month's last day
 *  (Jan 31 + 1 month → Feb 28/29). */
export function addMonths(date: string, n: number): string {
  const [y, m, day] = date.split('-').map(Number);
  const first = new Date(y, m - 1 + n, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const clamped = Math.min(day || 1, lastDay);
  return `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-${String(
    clamped,
  ).padStart(2, '0')}`;
}

/** Whole days from a → b (positive when b is after a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
}

/** YYYY-MM for grouping collections by month. */
export function monthKey(date: string): string {
  return (date || '').slice(0, 7);
}

export function formatDate(date: string): string {
  if (!date) {
    return '—';
  }
  const d = toDate(date);
  return d.toLocaleDateString('en-PH', {month: 'short', day: 'numeric', year: 'numeric'});
}

export function formatDateTime(iso: string): string {
  if (!iso) {
    return '';
  }
  const d = new Date(iso);
  return d.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}
