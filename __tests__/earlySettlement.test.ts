import {
  earlySettlementQuote,
  SETTLEMENT_FEE,
  SETTLEMENT_INCENTIVE_PCT,
} from '../src/services/earlySettlement';

describe('earlySettlementQuote', () => {
  test('buyer saves the incentive, pays the fee on top', () => {
    const remaining = 10000;
    const quote = earlySettlementQuote(remaining);
    const incentive = (remaining * SETTLEMENT_INCENTIVE_PCT) / 100;
    expect(quote.incentive).toBe(incentive);
    expect(quote.fee).toBe(SETTLEMENT_FEE);
    expect(quote.total).toBe(remaining - incentive + SETTLEMENT_FEE);
  });

  test('quote is always less than paying off the full balance', () => {
    const quote = earlySettlementQuote(20000);
    expect(quote.total).toBeLessThan(20000);
  });

  test('a fully paid plan settles for just the fee', () => {
    const quote = earlySettlementQuote(0);
    expect(quote.total).toBe(SETTLEMENT_FEE);
  });
});
