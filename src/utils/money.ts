/** Money helpers. */

export function formatMoney(amount: number, currency = '₱'): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return (
    currency +
    safe.toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** Formats an amount using a PayPal currency code, e.g. PHP -> ₱1,234.00. */
export function formatMoneyCode(amount: number, currencyCode: string): string {
  const symbols: Record<string, string> = {
    PHP: '₱',
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    AUD: 'A$',
    CAD: 'C$',
    SGD: 'S$',
  };
  return formatMoney(amount, symbols[currencyCode] ?? `${currencyCode} `);
}

export function formatMoney0(amount: number, currency = '₱'): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return currency + Math.round(safe).toLocaleString('en-PH');
}

export function parseMoney(input: string): number {
  const cleaned = String(input ?? '').replace(/[^0-9.]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
