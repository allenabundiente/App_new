/** Compact unique id — same scheme as the mobile app so ids are interchangeable. */
export function generateId(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}${time}${rand}`;
}
