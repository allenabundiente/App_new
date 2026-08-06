import {
  computePenalty,
  effectiveDueDate,
  planStatus,
} from '../src/services/penalty';

const P = {graceDays: 3, ratePerMonthPct: 2, capPct: 25};

describe('computePenalty', () => {
  test('no penalty inside the grace period', () => {
    expect(computePenalty(1000, '2026-01-10', '2026-01-13', P)).toBe(0);
  });

  test('penalty accrues daily after grace (2%/30 per day)', () => {
    // 10 days late → 7 days beyond grace → 1000 * 0.02/30 * 7 = 4.67
    expect(computePenalty(1000, '2026-01-10', '2026-01-20', P)).toBeCloseTo(4.67, 2);
  });

  test('penalty is capped at 25% of the installment', () => {
    // ~19 months late would be 375+ uncapped → capped at 25% of 1000 = 250
    expect(computePenalty(1000, '2024-01-01', '2025-07-20', P)).toBe(250);
  });

  test('paying before the due date is never penalized', () => {
    expect(computePenalty(1000, '2026-02-01', '2026-01-25', P)).toBe(0);
  });
});

describe('effectiveDueDate', () => {
  test('grace extensions shift the effective due date', () => {
    expect(effectiveDueDate('2026-01-10', 0)).toBe('2026-01-10');
    expect(effectiveDueDate('2026-01-10', 5)).toBe('2026-01-15');
  });
});

describe('planStatus', () => {
  const grace = 3;

  test('completed when there is no pending due', () => {
    expect(planStatus(null, null, '2026-01-15', grace)).toBe('completed');
  });

  test('active while within the grace window', () => {
    // due 2026-01-10, effective 2026-01-10, as of 2026-01-13 (3 days late)
    expect(planStatus('2026-01-10', '2026-01-10', '2026-01-13', grace)).toBe('active');
  });

  test('overdue past the grace window', () => {
    expect(planStatus('2026-01-10', '2026-01-10', '2026-01-20', grace)).toBe('overdue');
  });

  test('defaulted after 30+ days past grace', () => {
    expect(planStatus('2026-01-10', '2026-01-10', '2026-02-20', grace)).toBe('defaulted');
  });

  test('extra approved grace days push the overdue threshold', () => {
    // effective due shifts to 2026-01-18 with 8 extra days
    expect(planStatus('2026-01-10', '2026-01-18', '2026-01-20', grace)).toBe('active');
  });
});
