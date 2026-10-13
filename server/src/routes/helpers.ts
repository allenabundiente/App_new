/**
 * Small helpers the route files all share: catching async errors, working
 * out an admin's seller scope, and the user object we send to the client.
 */
import type {NextFunction, Request, Response} from 'express';
import {currentUser} from '../auth';
import type {User} from '../types';

/** Wraps an async handler so a thrown error becomes a 500 instead of a crash. */
export const h =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

/**
 * If an admin has an assignedSellerId they may only see that seller's
 * plans, payments and adjustments. Returns the sellerId to filter by, or
 * null for sellers, buyers and admins with no scope set.
 */
export const adminScope = (req: Request): string | null => {
  const me = currentUser(req);
  if (me.role === 'admin' && me.assignedSellerId) {
    return me.assignedSellerId;
  }
  return null;
};

/** Adds `sellerId = $n` to the where clause when an admin scope applies. */
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
 * Returns true when a scoped admin is asking for another seller's stuff, in
 * which case the handler should send a 403 and stop.
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

/** Takes the password hash off before sending a user to the app. */
export function safeUser(user: User): User {
  return {...user, password: ''};
}
