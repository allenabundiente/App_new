/**
 * Penalty - decides whether a plan is on track, overdue or defaulted, and
 * works out the late fee.
 */
import type {PlanStatus} from '../types';
import {addDays, daysBetween} from '../utils/date';
import {round2} from '../utils/money';

export interface PenaltyParams {
  graceDays: number; // free days after the due date
  ratePerMonthPct: number; // late fee per month, e.g. 2 means 2%
  capPct: number; // max fee, e.g. 25 means never over 25% of the installment
}

/**
 * Late fee on one installment, counted per day:
 *   perDay = amount * (rate/100) / 30
 *   penalty = perDay * (daysLate - grace), capped at amount * cap/100
 */
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

/** The real due date, counting any extra grace days that were approved. */
export function effectiveDueDate(dueDate: string, graceExtraDays: number): string {
  return graceExtraDays > 0 ? addDays(dueDate, graceExtraDays) : dueDate;
}

/**
 * Status of a plan based on its next unpaid due date:
 *  - nothing left to pay        = completed
 *  - more than 30 days late     = defaulted
 *  - late at all                = overdue
 *  - otherwise                  = active
 */
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

/** Label and colour for each status tag in the UI. */
export const STATUS_META: Record<PlanStatus, {label: string; color: string; soft: string}> = {
  active: {label: 'On track', color: '#a78bfa', soft: 'rgba(109,94,242,0.16)'},
  overdue: {label: 'Overdue', color: '#f59e0b', soft: 'rgba(245,158,11,0.14)'},
  defaulted: {label: 'Defaulted', color: '#f43f5e', soft: 'rgba(244,63,94,0.13)'},
  completed: {label: 'Completed', color: '#22c55e', soft: 'rgba(34,197,94,0.14)'},
  cancelled: {label: 'Cancelled', color: '#93a0b8', soft: 'rgba(148,163,184,0.14)'},
};
