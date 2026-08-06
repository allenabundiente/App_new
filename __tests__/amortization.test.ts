import {buildSchedule, pmt, totalInterest, totalPayable} from '../src/services/amortization';

describe('pmt', () => {
  test('0% APR is a simple division', () => {
    expect(pmt(12000, 0, 12)).toBe(1000);
  });

  test('positive APR produces a known monthly payment', () => {
    // 12,000 at 12% APR for 12 months → ~1066.19
    expect(pmt(12000, 12, 12)).toBeCloseTo(1066.19, 2);
  });

  test('no principal yields zero', () => {
    expect(pmt(0, 24, 12)).toBe(0);
  });
});

describe('buildSchedule', () => {
  test('generates one row per month, starting one month after start', () => {
    const rows = buildSchedule(12000, 0, 12, '2026-01-15');
    expect(rows).toHaveLength(12);
    expect(rows[0].dueDate).toBe('2026-02-15');
    expect(rows[11].dueDate).toBe('2027-01-15');
  });

  test('last installment absorbs rounding drift so the plan balances', () => {
    const financed = 24999 - 5000; // 19999
    const rows = buildSchedule(financed, 24, 12, '2026-01-01');
    const total = rows.reduce((a, r) => a + r.amount, 0);
    // Total paid ≈ financed + interest computed from the rounded payment.
    const installment = pmt(financed, 24, 12);
    expect(total).toBeCloseTo(installment * 12, 2);
  });

  test('clamps end-of-month dates (Jan 31 + 1 month → Feb 28)', () => {
    const rows = buildSchedule(6000, 0, 3, '2026-01-31');
    expect(rows[0].dueDate).toBe('2026-02-28');
    expect(rows[1].dueDate).toBe('2026-03-31');
  });
});

describe('totals', () => {
  test('totalPayable and totalInterest are consistent', () => {
    const installment = pmt(10000, 18, 24);
    expect(totalPayable(installment, 24)).toBe(installment * 24);
    expect(totalInterest(10000, installment, 24)).toBeCloseTo(
      installment * 24 - 10000,
      2,
    );
  });
});
