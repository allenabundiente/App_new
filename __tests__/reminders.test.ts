import {scanPlan, type PlanSnapshot} from '../src/services/reminders';
import type {Plan, ScheduleItem} from '../src/types';

const plan: Plan = {
  id: 'pl-1',
  planNo: 'HT-1001',
  sellerId: 's',
  buyerId: 'b',
  productId: 'p1',
  productName: 'Phone',
  productEmoji: '📱',
  price: 12000,
  downPayment: 2000,
  financed: 10000,
  apr: 0,
  term: 10,
  installment: 1000,
  startDate: '2025-01-01',
  status: 'active',
  graceExtra: 0,
  notes: '',
  createdAt: '2025-01-01T00:00:00Z',
};

function nextDue(dueDate: string): ScheduleItem {
  return {id: 'sch-1', planId: plan.id, dueDate, amount: 1000, status: 'pending', paidDate: null, note: ''};
}

function snap(due: ScheduleItem | null, overrides: Partial<PlanSnapshot> = {}): PlanSnapshot {
  return {
    plan,
    nextDue: due,
    graceDays: 3,
    penaltyRate: 2,
    penaltyCap: 25,
    reminderLead: 3,
    ...overrides,
  };
}

describe('scanPlan', () => {
  test('no reminders when nothing is due', () => {
    expect(scanPlan(snap(null), '2026-01-15')).toEqual([]);
    expect(scanPlan(snap(null, {plan: {...plan, status: 'completed'}}), '2026-01-15')).toEqual([]);
  });

  test('due-soon reminder inside the lead window', () => {
    const actions = scanPlan(snap(nextDue('2026-01-18')), '2026-01-15');
    expect(actions).toHaveLength(1);
    expect(actions[0].recipientId).toBe('b');
    expect(actions[0].type).toBe('warn');
    expect(actions[0].title).toContain('due soon');
    expect(actions[0].dedupKey).toBe('due-pl-1-2026-01-18');
  });

  test('no due-soon reminder too far ahead', () => {
    expect(scanPlan(snap(nextDue('2026-02-01')), '2026-01-15')).toEqual([]);
  });

  test('overdue plan alerts both buyer and seller with a penalty', () => {
    const actions = scanPlan(snap(nextDue('2026-01-01')), '2026-01-20');
    // Due date is long past → the lead-window reminder is skipped, so we get
    // exactly the overdue pair (buyer alert + seller alert).
    expect(actions).toHaveLength(2);
    const recipients = actions.map(a => a.recipientId);
    expect(recipients).toContain('b');
    expect(recipients).toContain('s');
    expect(actions.some(a => a.body.includes('penalty'))).toBe(true);
  });

  test('dedup keys distinguish a due-soon from an overdue event', () => {
    const actions = scanPlan(snap(nextDue('2026-01-16')), '2026-01-15');
    // 1 day to go: inside the lead window → due-soon only, not overdue.
    expect(actions.map(a => a.dedupKey)).toContain('due-pl-1-2026-01-16');
  });
});
