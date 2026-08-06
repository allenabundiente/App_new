import type {PlanStatus} from '../types';
import {addDays, daysBetween} from './date';
import {round2} from './money';

export interface PenaltyParams {
  graceDays: number;
  ratePerMonthPct: number;
  capPct: number;
}

export function computePenalty(
  installmentAmount: number,
  dueDate: string,
  asOf: string,
  params: PenaltyParams,
): number {
  const late = daysBetween(dueDate, asOf) - params.graceDays;
  if (late <= 0) {
    return 0;
  }
  const perDay = (installmentAmount * params.ratePerMonthPct) / 100 / 30;
  const total = perDay * late;
  const cap = (installmentAmount * params.capPct) / 100;
  return round2(Math.min(total, cap));
}

export function effectiveDueDate(dueDate: string, graceExtraDays: number): string {
  return graceExtraDays > 0 ? addDays(dueDate, graceExtraDays) : dueDate;
}

export function planStatus(
  nextDueDate: string | null,
  effectiveDue: string | null,
  asOf: string,
  graceDays: number,
): PlanStatus {
  if (!nextDueDate || !effectiveDue) {
    return 'completed';
  }
  const late = daysBetween(effectiveDue, asOf) - graceDays;
  if (late > 30) {
    return 'defaulted';
  }
  if (late > 0) {
    return 'overdue';
  }
  return 'active';
}
