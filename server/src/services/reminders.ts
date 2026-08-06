/**
 * Server-side due reminders.
 *
 * Every scan stamps each notification with a deterministic `dedupKey`
 * (e.g. `overdue-pl-xxx-2026-08-01`), backed by a partial unique index on
 * notifications(dedupKey), so a reminder is emitted exactly once — even if
 * the scan runs every few minutes.
 *
 * `scanPlan` is a pure port of the mobile app's reminder engine
 * (src/services/reminders.ts) so the rules are identical on device and server.
 * `runDueReminders` is the DB-backed job the cron endpoint / scheduler calls.
 */
import {getPool, getSettings, mapPlan, mapSchedule, q, qOne} from '../db';
import {daysBetween, nowIso, today} from './date';
import {generateId} from './id';
import {computePenalty, effectiveDueDate, planStatus} from './penalty';
import type {Plan, ScheduleItem} from '../types';

export interface ReminderAction {
  title: string;
  body: string;
  type: 'money' | 'success' | 'warn' | 'danger' | 'info' | 'plan';
  recipientId: string;
  /** Dedup key — the same action is only emitted once per key. */
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

/** Scan one plan for reminders. Returns an empty array when nothing is due. */
export function scanPlan(s: PlanSnapshot, asOf: string): ReminderAction[] {
  const {plan, nextDue} = s;
  if (!nextDue || plan.status === 'completed' || plan.status === 'cancelled') {
    return [];
  }
  const effectiveDue = effectiveDueDate(nextDue.dueDate, plan.graceExtra);
  const days = daysBetween(asOf, effectiveDue);
  const actions: ReminderAction[] = [];

  // Due-soon reminder inside the lead window (and not already past).
  if (days >= 0 && days <= s.reminderLead) {
    actions.push({
      recipientId: plan.buyerId,
      type: 'warn',
      title: 'Payment due soon ⏰',
      body: `${plan.planNo} — ${nextDue.amount} is due in ${days === 0 ? 'today' : `${days} day(s)`}.`,
      dedupKey: `due-${plan.id}-${nextDue.dueDate}`,
    });
  }

  const status = planStatus(nextDue.dueDate, effectiveDue, asOf, s.graceDays);
  if (status === 'overdue' || status === 'defaulted') {
    const penalty = computePenalty(nextDue.amount, effectiveDue, asOf, {
      graceDays: s.graceDays,
      ratePerMonthPct: s.penaltyRate,
      capPct: s.penaltyCap,
    });
    const penaltyText = penalty > 0 ? ` — penalty ${penalty} applies` : '';
    actions.push({
      recipientId: plan.buyerId,
      type: 'danger',
      title: 'Payment overdue 🚨',
      body: `${plan.planNo} is past due${penaltyText}.`,
      dedupKey: `overdue-${plan.id}-${nextDue.dueDate}`,
    });
    actions.push({
      recipientId: plan.sellerId,
      type: 'danger',
      title: 'Overdue alert 🚨',
      body: `${plan.planNo} (${plan.productName}) is past due.`,
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
 * Scan every active plan for due/overdue reminders and insert notifications
 * that have not already been emitted (dedupKey). Safe to run on an interval
 * or from an external cron — repeated runs never duplicate a notification.
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
      // The partial unique index on notifications(dedupKey) is the real guard
      // against duplicates — the SELECT below only keeps the count accurate;
      // under a rare concurrent scan the count may over-report by one, but the
      // ON CONFLICT DO NOTHING insert can never create a duplicate.
      const exists = await qOne<{n: number}>(
        'SELECT COUNT(*)::int AS n FROM notifications WHERE dedupKey = $1',
        [action.dedupKey],
      );
      if (exists && exists.n > 0) {
        continue; // already emitted — idempotent scan
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
