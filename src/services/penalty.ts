/**
 * Penalty engine — the rules that decide whether a plan is on track,
 * overdue or defaulted, and how much late fee accrues.
 * Pure functions, unit tested.
 */
import type {PlanStatus} from '../types';
import {addDays, daysBetween} from '../utils/date';
import {round2} from '../utils/money';

export interface PenaltyParams {
  graceDays: number; // free days after the due date
  ratePerMonthPct: number; // e.g. 2 → 2% of the installment per month
  capPct: number; // e.g. 25 → never more than 25% of the installment
}

/**
 * Penalty on one installment, prorated daily:
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

/** Effective due date for a plan = due date + any approved grace extension. */
export function effectiveDueDate(dueDate: string, graceExtraDays: number): string {
  return graceExtraDays > 0 ? addDays(dueDate, graceExtraDays) : dueDate;
}

/**
 * Derive a plan's status from its next unpaid due date.
 *  - no pending due          → 'completed'
 *  - late > 30 days (beyond grace) → 'defaulted'
 *  - late > 0 days           → 'overdue'
 *  - otherwise               → 'active'
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

/** Status tag meta for UI rendering. */
export const STATUS_META: Record<PlanStatus, {label: string; color: string; soft: string}> = {
  active: {label: 'On track', color: '#a78bfa', soft: 'rgba(109,94,242,0.16)'},
  overdue: {label: 'Overdue', color: '#f59e0b', soft: 'rgba(245,158,11,0.14)'},
  defaulted: {label: 'Defaulted', color: '#f43f5e', soft: 'rgba(244,63,94,0.13)'},
  completed: {label: 'Completed', color: '#22c55e', soft: 'rgba(34,197,94,0.14)'},
  cancelled: {label: 'Cancelled', color: '#93a0b8', soft: 'rgba(148,163,184,0.14)'},
};
