/**
 * The routes for chat messages, notifications, the audit log and the
 * reminder cron.
 *
 * They use the `messages`, `notifications` and `audit_log` tables. Both the
 * main app (src/app.ts) and the engagement service
 * (src/entries/engagement.ts) mount them.
 */
import {Router} from 'express';
import {timingSafeEqual} from 'node:crypto';
import {mapAudit, mapMessage, mapNotification, q, qOne} from '../db';
import {toNum, toStr} from '../convert';
import {generateId} from '../services/id';
import {nowIso} from '../services/date';
import {runDueReminders} from '../services/reminders';
import {requireAuth} from '../auth';
import type {Message, NotificationItem} from '../types';
import {adminScope, h} from './helpers';

export function createEngagementRouter(): Router {
  const r = Router();

  /* ----------------------------- notifications ----------------------------- */

  r.get(
    '/notifications',
    requireAuth,
    h(async (req, res) => {
      const limit = Math.min(200, toNum(req.query.limit) || 30);
      const rows = await q(
        'SELECT * FROM notifications WHERE userId = $1 ORDER BY createdAt DESC LIMIT $2',
        [req.query.userId, limit],
      );
      res.json({notifications: rows.map(mapNotification)});
    }),
  );

  r.get(
    '/notifications/unread',
    requireAuth,
    h(async (req, res) => {
      const rows = await q(
        'SELECT COUNT(*)::int AS n FROM notifications WHERE userId = $1 AND isRead = 0',
        [req.query.userId],
      );
      res.json({count: toNum(rows[0]?.n)});
    }),
  );

  // Marks everything as read. The app calls this when the notification list
  // is opened so the red dot goes away.
  r.post(
    '/notifications/read',
    requireAuth,
    h(async (req, res) => {
      await q('UPDATE notifications SET isRead = 1 WHERE userId = $1', [req.body?.userId]);
      res.json({ok: true});
    }),
  );

  // Marks the chat notifications for one plan as read. The app calls this
  // when that chat is opened. Chat notifications have a `{planId}|` prefix
  // in the body so we know which plan they belong to.
  r.post(
    '/notifications/chat-read',
    requireAuth,
    h(async (req, res) => {
      await q(
        "UPDATE notifications SET isRead = 1 WHERE userId = $1 AND type = 'chat' AND body LIKE $2",
        [req.body?.userId, `${toStr(req.body?.planId)}|%`],
      );
      res.json({ok: true});
    }),
  );

  r.post(
    '/notifications',
    requireAuth,
    h(async (req, res) => {
      const notification: NotificationItem = {
        id: generateId('n-'),
        userId: toStr(req.body?.userId),
        type: (req.body?.type as NotificationItem['type']) ?? 'info',
        title: toStr(req.body?.title),
        body: toStr(req.body?.body),
        isRead: false,
        createdAt: nowIso(),
      };
      await q(
        `INSERT INTO notifications (id, userId, type, title, body, isRead, createdAt)
         VALUES ($1,$2,$3,$4,$5,0,$6)`,
        [notification.id, notification.userId, notification.type, notification.title,
          notification.body, notification.createdAt],
      );
      res.status(201).json({notification});
    }),
  );

  /* -------------------------------- messages ------------------------------- */

  r.get(
    '/messages',
    requireAuth,
    h(async (req, res) => {
      const rows = await q('SELECT * FROM messages WHERE planId = $1 ORDER BY createdAt', [
        req.query.planId,
      ]);
      res.json({messages: rows.map(mapMessage)});
    }),
  );

  r.post(
    '/messages',
    requireAuth,
    h(async (req, res) => {
      const message: Message = {
        id: generateId('m-'),
        planId: toStr(req.body?.planId),
        senderId: toStr(req.body?.senderId),
        recipientId: toStr(req.body?.recipientId),
        text: toStr(req.body?.text),
        isRead: false,
        createdAt: nowIso(),
      };
      await q(
        `INSERT INTO messages (id, planId, senderId, recipientId, text, isRead, createdAt)
         VALUES ($1,$2,$3,$4,$5,0,$6)`,
        [message.id, message.planId, message.senderId, message.recipientId, message.text,
          message.createdAt],
      );
      // The recipient's bell badge counts these and the popup shows them
      // while the app is open. The body has a `{planId}|` prefix so we know
      // which plan's chat to mark as read later.
      const planRow = await qOne('SELECT planNo FROM plans WHERE id = $1', [message.planId]);
      const planNo = toStr(planRow?.planNo) || 'plan';
      await q(
        `INSERT INTO notifications (id, userId, type, title, body, isRead, createdAt, dedupKey)
         VALUES ($1,$2,'chat',$3,$4,0,$5,$6)`,
        [
          generateId('n-'),
          message.recipientId,
          `New message on ${planNo}`,
          `${message.planId}|${message.text}`,
          nowIso(),
          `chat-${message.id}`,
        ],
      );
      res.status(201).json({message});
    }),
  );

  r.post(
    '/messages/read',
    requireAuth,
    h(async (req, res) => {
      await q('UPDATE messages SET isRead = 1 WHERE planId = $1 AND recipientId = $2', [
        req.body?.planId,
        req.body?.userId,
      ]);
      res.json({ok: true});
    }),
  );

  /* --------------------------------- audit -------------------------------- */

  r.get(
    '/audit',
    requireAuth,
    h(async (req, res) => {
      const limit = Math.min(500, toNum(req.query.limit) || 100);
      // An admin scoped to a seller only sees what that seller did, not the
      // whole log.
      const scoped = adminScope(req);
      const rows = scoped
        ? await q(
            'SELECT * FROM audit_log WHERE userId = $1 ORDER BY createdAt DESC LIMIT $2',
            [scoped, limit],
          )
        : await q('SELECT * FROM audit_log ORDER BY createdAt DESC LIMIT $1', [limit]);
      res.json({audit: rows.map(mapAudit)});
    }),
  );

  r.post(
    '/audit',
    requireAuth,
    h(async (req, res) => {
      await q(
        'INSERT INTO audit_log (id, userId, action, detail, createdAt) VALUES ($1,$2,$3,$4,$5)',
        [generateId('a-'), toStr(req.body?.userId), toStr(req.body?.action),
          toStr(req.body?.detail), nowIso()],
      );
      res.json({ok: true});
    }),
  );

  /* ------------------------- health & machine cron ------------------------ */

  // The due-reminder cron endpoint. It is guarded by a shared secret
  // (CRON_SECRET) sent as `x-cron-secret` rather than a user login, because
  // the keep-alive workflow and the uptime monitor call it, not the app.
  r.post(
    '/cron/reminders',
    h(async (req, res) => {
      const secret = process.env.CRON_SECRET;
      const sent = toStr(req.headers['x-cron-secret']);
      if (!secret) {
        res.status(503).json({ok: false, reason: 'CRON_SECRET is not configured on the server.'});
        return;
      }
      const a = Buffer.from(secret);
      const b = Buffer.from(sent);
      if (a.length === 0 || a.length !== b.length || !timingSafeEqual(a, b)) {
        res.status(401).json({ok: false, reason: 'Invalid cron secret.'});
        return;
      }
      const result = await runDueReminders();
      res.json({ok: true, ...result});
    }),
  );

  return r;
}
