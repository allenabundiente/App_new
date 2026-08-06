import type {SettlementQuote} from '../types';
import {round2} from './money';

export const SETTLEMENT_INCENTIVE_PCT = 2;
export const SETTLEMENT_FEE = 150;

export function earlySettlementQuote(remaining: number): SettlementQuote {
  const incentive = round2((remaining * SETTLEMENT_INCENTIVE_PCT) / 100);
  const total = round2(remaining - incentive + SETTLEMENT_FEE);
  return {remaining, incentive, fee: SETTLEMENT_FEE, total};
}
