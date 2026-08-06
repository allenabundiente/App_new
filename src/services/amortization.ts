/**
 * Amortization engine — computes equal monthly installments (PMT) and
 * generates the payment schedule for a plan. Pure functions, unit tested.
 */
import {addMonths} from '../utils/date';
import {round2} from '../utils/money';

export interface ScheduledPayment {
  dueDate: string;
  amount: number;
}

/**
 * Equal-payment amortization. annualPct is the APR; the monthly rate is
 * annual / 12. A 0% rate falls back to a simple division.
 */
export function pmt(principal: number, annualPct: number, months: number): number {
  if (!principal || months <= 0) {
    return 0;
  }
  const r = annualPct / 100 / 12;
  if (r === 0) {
    return round2(principal / months);
  }
  const p = Math.pow(1 + r, months);
  return round2((principal * r * p) / (p - 1));
}

/**
 * Build a monthly schedule from a start date. The last installment absorbs
 * the rounding drift so the plan balances to the cent.
 */
export function buildSchedule(
  financed: number,
  annualPct: number,
  months: number,
  startDate: string,
): ScheduledPayment[] {
  const installment = pmt(financed, annualPct, months);
  const totalInterest = round2(installment * months - financed);
  const out: ScheduledPayment[] = [];
  for (let i = 0; i < months; i++) {
    let amount = installment;
    if (i === months - 1) {
      amount = round2(financed + totalInterest - installment * (months - 1));
    }
    out.push({dueDate: addMonths(startDate, i + 1), amount});
  }
  return out;
}

/** Total payable = sum of installments (incl. interest). */
export function totalPayable(installment: number, months: number): number {
  return round2(installment * months);
}

export function totalInterest(financed: number, installment: number, months: number): number {
  return round2(installment * months - financed);
}
