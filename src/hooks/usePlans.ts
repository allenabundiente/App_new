/**
 * usePlans — hydrates raw Plan rows into rich summaries: next due, remaining
 * balance, live penalty, paid count. Runs in parallel and re-runs whenever
 * the store's refresh tick changes (i.e. after any DB mutation).
 */
import {useEffect, useState} from 'react';
import type {Plan, ScheduleItem} from '../types';
import {planWithDerived} from '../db/dataAccess';
import {useAppStore} from '../store/AppStore';

export interface PlanSummary {
  plan: Plan;
  nextDue: ScheduleItem | null;
  remaining: number;
  penalty: number;
  paidCount: number;
  status: Plan['status'];
}

export function usePlans(plans: Plan[]): PlanSummary[] {
  const {tick} = useAppStore();
  const [summaries, setSummaries] = useState<PlanSummary[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await Promise.all(plans.map(p => planWithDerived(p)));
      if (alive) {
        setSummaries(rows);
      }
    })();
    return () => {
      alive = false;
    };
  }, [plans, tick]);

  return summaries;
}

export function usePlanSummary(plan: Plan | null): PlanSummary | null {
  const {tick} = useAppStore();
  const [summary, setSummary] = useState<PlanSummary | null>(null);

  useEffect(() => {
    let alive = true;
    if (!plan) {
      setSummary(null);
      return;
    }
    (async () => {
      const row = await planWithDerived(plan);
      if (alive) {
        setSummary(row);
      }
    })();
    return () => {
      alive = false;
    };
  }, [plan, tick]);

  return summary;
}
