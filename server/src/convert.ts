/** Postgres gives numbers back as strings sometimes, so tidy them up here. */

export function toStr(v: unknown): string {
  return v == null ? '' : String(v);
}

export function toNum(v: unknown): number {
  return typeof v === 'number' ? v : Number(v) || 0;
}

export function toBool(v: unknown): boolean {
  return v === 1 || v === true || v === '1' || v === 'true';
}
