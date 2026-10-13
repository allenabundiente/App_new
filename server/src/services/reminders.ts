/**
 * The reminders that go out for due and overdue plans.
 *
 * Every notification is saved with a `dedupKey` like
 * `overdue-pl-xxx-2026-08-01`. There is a unique index on that column, so
 * even though the scan runs every few minutes a reminder only goes out once.
 *
 * `scanPlan` does the same job as the reminder engine in the mobile app
 * (src/services/reminders.ts) so both follow the same rules.
 * `runDueReminders` is the one the cron endpoint and the scheduler call.
 */
import {getPool, getSettings, mapPlan, mapSchedule, q, qOne} from '../db';
import {daysBetween, nowIso, today} from './date';
import {generateId} from './id';
import {computePenalty, effectiveDueDate, planStatus} from './penalty';
import type {Plan, ScheduleItem} from '../types';

export interface ReminderAction {
  title: string;
  body: string;
  type: 'money' | 'success' | 'warn' | 'danger' | 'info' | 'plan' | 'chat';
  recipientId: string;
  /** Stops the same reminder being saved twice. */
  dedupKey: string;
}

export interface PlanSnapshot {
  plan: Plan;
  nextDue: ScheduleItem | null;
  graceDays: number;
  penaltyRate: number;
  penaltyCap: number;
  reminderLead: number;
}

/** Checks one plan. Empty list means there is nothing to remind about. */
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
      // The `{planId}|` prefix is so tapping the notification opens the plan.
      body: `${plan.id}|${plan.planNo} — ${outstanding} is due in ${days === 0 ? 'today' : `${days} day(s)`}.`,
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
      body: `${plan.id}|${plan.planNo} is past due${penaltyText}.`,
      dedupKey: `overdue-${plan.id}-${nextDue.dueDate}`,
    });
    actions.push({
      recipientId: plan.sellerId,
      type: 'danger',
      title: 'Overdue alert',
      body: `${plan.id}|${plan.planNo} (${plan.productName}) is past due.`,
      dedupKey: `overdue-seller-${plan.id}-${nextDue.dueDate}`,
    });
  }
  return actions;
}

export interface ReminderRunResult {
  scanned: number;
  generated: number;
}

/**
 * Goes through every active plan and inserts the due and overdue
 * notifications that haven't already been sent, using the dedupKey. It is
 * safe to run this on a timer or from an external cron, running it twice
 * won't create duplicates.
 */
export async function runDueReminders(opts: {asOf?: string} = {}): Promise<ReminderRunResult> {
  const asOf = opts.asOf ?? today();
  const settings = await getSettings();
  const plans = (await q('SELECT * FROM plans WHERE status = $1', ['active'])).map(mapPlan);

  let generated = 0;
  for (const plan of plans) {
    const nextRow = await qOne(
      'SELECT * FROM plan_schedule WHERE planId = $1 AND status = $2 ORDER BY dueDate LIMIT 1',
      [plan.id, 'pending'],
    );
    if (!nextRow) {
      continue;
    }
    const nextDue = mapSchedule(nextRow);
    const actions = scanPlan(
      {
        plan,
        nextDue,
        graceDays: settings.graceDays,
        penaltyRate: settings.penaltyRate,
        penaltyCap: settings.penaltyCap,
        reminderLead: settings.reminderLead,
      },
      asOf,
    );
    for (const action of actions) {
      // The unique index on notifications(dedupKey) is what really stops
      // duplicates. The SELECT below is only there to keep the count right,
      // and the insert uses ON CONFLICT DO NOTHING so it can never add a
      // second copy.
      const exists = await qOne<{n: number}>(
        'SELECT COUNT(*)::int AS n FROM notifications WHERE dedupKey = $1',
        [action.dedupKey],
      );
      if (exists && exists.n > 0) {
        continue; // already sent, so skip it
      }
      await getPool().query(
        `INSERT INTO notifications (id, userId, type, title, body, isRead, createdAt, dedupKey)
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7)
         ON CONFLICT DO NOTHING`,
        [generateId('n-'), action.recipientId, action.type, action.title, action.body, nowIso(), action.dedupKey],
      );
      generated += 1;
    }
  }
  return {scanned: plans.length, generated};
}
