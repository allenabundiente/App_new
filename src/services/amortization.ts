/**
 * Amortization - computes the monthly installment for a plan and builds
 * the payment schedule.
 */
import {addMonths} from '../utils/date';
import {round2} from '../utils/money';

export interface ScheduledPayment {
  dueDate: string;
  amount: number;
}

/**
 * Works out the equal monthly installment.
 * annualPct is the yearly rate, the monthly rate is annualPct / 12.
 * A 0% plan is just the principal split evenly.
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
 * Builds the list of monthly dues from the start date. The last one takes
 * the rounding difference so the total adds up exactly.
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

/** Everything the buyer pays in the end (principal + interest). */
export function totalPayable(installment: number, months: number): number {
  return round2(installment * months);
}

export function totalInterest(financed: number, installment: number, months: number): number {
  return round2(installment * months - financed);
}
