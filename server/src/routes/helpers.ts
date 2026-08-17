/**
 * Shared Express helpers for the route modules — the pieces every service
 * uses: async error wrapping, admin oversight scope, and the safe-user
 * serializer.
 */
import type {NextFunction, Request, Response} from 'express';
import {currentUser} from '../auth';
import type {User} from '../types';

/** Wrap async handlers so thrown errors become 500 JSON instead of crashes. */
export const h =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

/**
 * Admin oversight scope: an admin with assignedSellerId may only read that
 * seller's plans/payments/adjustments. Returns a sellerId to filter by, or
 * null for sellers/buyers/unscoped admins (who pass their own params).
 */
export const adminScope = (req: Request): string | null => {
  const me = currentUser(req);
  if (me.role === 'admin' && me.assignedSellerId) {
    return me.assignedSellerId;
  }
  return null;
};

/** Push `sellerId = $n` into the where-clause if an admin scope applies. */
export const applyScope = (
  req: Request,
  where: string[],
  params: unknown[],
  col = 'sellerId',
) => {
  const scoped = adminScope(req);
  if (scoped) {
    params.push(scoped);
    where.push(`${col} = $${params.length}`);
  }
};

/**
 * 403 a scoped admin whose request targets another seller's resource.
 * Returns true when the request must be rejected (handler should stop).
 */
export const outsideScope = (
  req: Request,
  res: Response,
  sellerId: string | null | undefined,
) => {
  const scoped = adminScope(req);
  if (scoped && sellerId !== scoped) {
    res.status(403).json({error: 'Outside your oversight scope.'});
    return true;
  }
  return false;
};

/** Strip the password hash before sending a user to the client. */
export function safeUser(user: User): User {
  return {...user, password: ''};
}
