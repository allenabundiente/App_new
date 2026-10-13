/**
 * Reminder scan - looks at a plan and decides which reminders should be
 * sent. Returns them as a list and the repository saves them.
 */
import type {NotificationItem, Plan, ScheduleItem} from '../types';
import {daysBetween} from '../utils/date';
import {computePenalty, effectiveDueDate, planStatus} from './penalty';

export interface PlanSnapshot {
  plan: Plan;
  nextDue: ScheduleItem | null;
  graceDays: number;
  penaltyRate: number;
  penaltyCap: number;
  reminderLead: number;
}

export interface ReminderAction {
  title: string;
  body: string;
  type: NotificationItem['type'];
  recipientId: string;
  /** Stops the same reminder being sent twice. */
  dedupKey: string;
}

/**
 * Check one plan. Empty list means nothing to remind about.
 */
export function scanPlan(s: PlanSnapshot, asOf: string): ReminderAction[] {
  const {plan, nextDue} = s;
  if (!nextDue || plan.status === 'completed' || plan.status === 'cancelled') {
    return [];
  }
  const effectiveDue = effectiveDueDate(nextDue.dueDate, plan.graceExtra);
  const days = daysBetween(asOf, effectiveDue);
  const outstanding = Math.max(0, nextDue.amount - nextDue.paidAmount);
  const actions: ReminderAction[] = [];

  // Reminder for a payment that is coming up soon.
  if (days >= 0 && days <= s.reminderLead) {
    actions.push({
      recipientId: plan.buyerId,
      type: 'warn',
      title: 'Payment due soon',
      body: `${plan.planNo} — ${outstanding} is due in ${days === 0 ? 'today' : `${days} day(s)`}.`,
      dedupKey: `due-${plan.id}-${nextDue.dueDate}`,
    });
  }

  const status = planStatus(nextDue.dueDate, effectiveDue, asOf, s.graceDays);
  if (status === 'overdue' || status === 'defaulted') {
    const penalty = computePenalty(outstanding, effectiveDue, asOf, {
      graceDays: s.graceDays,
      ratePerMonthPct: s.penaltyRate,
      capPct: s.penaltyCap,
    });
    const penaltyText = penalty > 0 ? ` — penalty ${penalty} applies` : '';
    actions.push({
      recipientId: plan.buyerId,
      type: 'danger',
      title: 'Payment overdue',
      body: `${plan.planNo} is past due${penaltyText}.`,
      dedupKey: `overdue-${plan.id}-${nextDue.dueDate}`,
    });
    actions.push({
      recipientId: plan.sellerId,
      type: 'danger',
      title: 'Overdue alert',
      body: `${plan.planNo} (${plan.productName}) is past due.`,
      dedupKey: `overdue-seller-${plan.id}-${nextDue.dueDate}`,
    });
  }
  return actions;
}
