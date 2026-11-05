/**
 * A tiny hand-off between a notification press (which can happen while the
 * app is killed) and the React navigation stack. Notifee's background event
 * handler stores the plan id here; the shell consumes it once after login.
 */
import {kv} from '../storage/kv';
import type {Notification} from '@notifee/react-native';
import {notificationTarget} from './notifications';

const PENDING_KEY = 'notifications.pendingTarget';

export interface NotificationPressTarget {
  planId: string;
  openChat: boolean;
  notificationId?: string;
}

export function rememberNotificationPress(notification: Notification | undefined): void {
  const target = notificationTarget(notification);
  if (target) {
    kv.set(PENDING_KEY, JSON.stringify({...target, notificationId: notification?.id}));
  }
}

export function clearNotificationPress(): void {
  kv.remove(PENDING_KEY);
}

export function consumeNotificationPress(): NotificationPressTarget | null {
  const raw = kv.getString(PENDING_KEY);
  if (!raw) {
    return null;
  }
  kv.remove(PENDING_KEY);
  try {
    const parsed = JSON.parse(raw) as Partial<NotificationPressTarget>;
    if (typeof parsed.planId === 'string' && parsed.planId.startsWith('pl-')) {
      return {
        planId: parsed.planId,
        openChat: parsed.openChat === true,
        notificationId: typeof parsed.notificationId === 'string' ? parsed.notificationId : undefined,
      };
    }
  } catch {
    // Ignore a malformed value from an older build.
  }
  return null;
}
