import {addMonths} from './date';
import {round2} from './money';

export interface ScheduledPayment {
  dueDate: string;
  amount: number;
}

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
