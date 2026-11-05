/**
 * Device notifications.
 *
 * The app already has an in-app notification feed and a server-side reminder
 * scanner. This service mirrors those updates into the phone's notification
 * tray, and schedules the next due date locally so a buyer still gets a
 * reminder when the app is closed.
 *
 * These are local notifications: the schedule is handed to Android/iOS when
 * the app refreshes. Remote delivery while the app is killed would need a
 * provider such as Firebase Cloud Messaging or APNs, plus its credentials.
 */
import notifee, {
  AndroidImportance,
  AuthorizationStatus,
  EventType,
  TriggerType,
  type Notification,
} from '@notifee/react-native';
import {Linking, Platform} from 'react-native';
import type {NotificationItem} from '../types';
import {formatDate} from '../utils/date';
import {formatMoney} from '../utils/money';
import {kv} from '../storage/kv';

const CHANNEL_ID = 'hulogtrack-updates';
const CHANNEL_NAME = 'HulogTrack updates';
const SMALL_ICON = 'ic_notification';
const PERMISSION_ASKED_KEY = 'notifications.permissionAsked';

export type NotificationPermissionState =
  | 'authorized'
  | 'denied'
  | 'not-determined'
  | 'unavailable';

/** The part of a stored notification body after the `{planId}|` prefix. */
export function notificationText(body: string): string {
  const sep = body.indexOf('|');
  return sep >= 0 ? body.slice(sep + 1) : body;
}

/** The plan a notification belongs to, if its body has a `pl-` prefix. */
export function notificationPlanId(body: string): string | null {
  const sep = body.indexOf('|');
  if (sep <= 0) {
    return null;
  }
  const maybe = body.slice(0, sep);
  return maybe.startsWith('pl-') ? maybe : null;
}

/** A notification tap target, read from Notifee's notification data. */
export function notificationTarget(
  notification: Notification | undefined,
): {planId: string; openChat: boolean} | null {
  const planId = notification?.data?.planId;
  if (typeof planId !== 'string' || !planId.startsWith('pl-')) {
    return null;
  }
  return {
    planId,
    openChat: notification?.data?.kind === 'chat',
  };
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  await notifee.createChannel({
    id: CHANNEL_ID,
    name: CHANNEL_NAME,
    importance: AndroidImportance.HIGH,
    vibration: true,
    badge: true,
  });
}

function stateFromSettings(settings: Awaited<ReturnType<typeof notifee.getNotificationSettings>>): NotificationPermissionState {
  switch (settings.authorizationStatus) {
    case AuthorizationStatus.AUTHORIZED:
    case AuthorizationStatus.PROVISIONAL:
      return 'authorized';
    case AuthorizationStatus.DENIED:
      return 'denied';
    default:
      return 'not-determined';
  }
}

export async function notificationPermissionState(): Promise<NotificationPermissionState> {
  try {
    return stateFromSettings(await notifee.getNotificationSettings());
  } catch {
    return 'unavailable';
  }
}

/** Asks the OS for permission and returns the resulting state. */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  try {
    const settings = await notifee.requestPermission({
      alert: true,
      badge: true,
      sound: true,
    });
    const state = stateFromSettings(settings);
    if (state === 'authorized') {
      await ensureChannel();
      kv.set(PERMISSION_ASKED_KEY, true);
    }
    return state;
  } catch {
    return 'unavailable';
  }
}

/**
 * Called once after sign-in. It asks the first time only, so a user who
 * declined is not prompted on every launch. The profile screen has an
 * explicit button for asking again or opening system settings.
 */
export async function ensureNotificationPermission(): Promise<NotificationPermissionState> {
  const state = await notificationPermissionState();
  if (state === 'authorized') {
    await ensureChannel().catch(() => undefined);
    return state;
  }
  if (state === 'unavailable') {
    return state;
  }
  // Android reports "denied" before the first request, so the stored flag is
  // what prevents us from prompting again after the user says no.
  if (state === 'denied' && (kv.getBoolean(PERMISSION_ASKED_KEY) ?? false)) {
    return state;
  }
  kv.set(PERMISSION_ASKED_KEY, true);
  return requestNotificationPermission();
}

export async function openNotificationSettings(): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      await notifee.openNotificationSettings(CHANNEL_ID);
    } else {
      await Linking.openSettings();
    }
  } catch {
    // The settings app is not available in every simulator.
  }
}

function notificationColorFor(type: NotificationItem['type']): string {
  switch (type) {
    case 'money':
    case 'success':
      return '#16a34a';
    case 'warn':
      return '#d97706';
    case 'danger':
      return '#dc2626';
    case 'chat':
      return '#2563eb';
    default:
      return '#6d28d9';
  }
}

/** Displays one server/in-app notification in the OS notification tray. */
export async function showDeviceNotification(
  item: Pick<NotificationItem, 'id' | 'userId' | 'type' | 'title' | 'body' | 'createdAt'>,
): Promise<boolean> {
  if ((await notificationPermissionState()) !== 'authorized') {
    return false;
  }
  try {
    await ensureChannel();
    const planId = notificationPlanId(item.body);
    const timestamp = Date.parse(item.createdAt);
    await notifee.displayNotification({
      id: item.id,
      title: item.title,
      body: notificationText(item.body),
      data: {
        planId: planId ?? '',
        kind: item.type,
        notificationId: item.id,
      },
      android: {
        channelId: CHANNEL_ID,
        smallIcon: SMALL_ICON,
        color: notificationColorFor(item.type),
        pressAction: {id: 'default', launchActivity: 'default'},
        autoCancel: true,
        groupId: planId ? `plan-${planId}` : undefined,
        timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
        showTimestamp: true,
      },
      ios: {
        sound: 'default',
        threadId: planId ? `plan-${planId}` : undefined,
        foregroundPresentationOptions: {alert: true, badge: true, sound: true},
      },
    });
    return true;
  } catch {
    // A missing icon or a revoked permission should never break the app.
    return false;
  }
}

export interface DueReminder {
  planId: string;
  planNo: string;
  dueDate: string;
  amount: number;
}

/** Nine in the morning, leadDays before the due date. */
function dueReminderTimestamp(dueDate: string, leadDays: number): number | null {
  const [year, month, day] = dueDate.split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }
  const due = new Date(year, month - 1, day, 9, 0, 0, 0);
  const lead = new Date(due);
  lead.setDate(lead.getDate() - Math.max(0, leadDays));
  const now = Date.now();
  if (lead.getTime() > now + 60_000) {
    return lead.getTime();
  }
  // If the reminder date has passed, still schedule the due-date morning.
  if (due.getTime() > now + 60_000) {
    return due.getTime();
  }
  return null;
}

/** Removes only the due-date reminders scheduled by this app. */
export async function cancelScheduledDueNotifications(): Promise<void> {
  try {
    const pending = await notifee.getTriggerNotifications();
    await Promise.all(
      pending
        .filter(t => t.notification.data?.scheduledBy === 'due' && t.notification.id)
        .map(t => notifee.cancelTriggerNotification(t.notification.id as string)),
    );
  } catch {
    // No scheduled notifications, or the native module is unavailable.
  }
}

/**
 * Replaces the next-due reminders with the supplied plans. Safe to call after
 * every refresh: old due reminders are cancelled first, then the current
 * next payment for each plan is scheduled.
 */
export async function scheduleDueReminders(
  reminders: DueReminder[],
  leadDays: number,
): Promise<number> {
  await cancelScheduledDueNotifications();
  if ((await notificationPermissionState()) !== 'authorized') {
    return 0;
  }
  await ensureChannel();
  let scheduled = 0;
  for (const reminder of reminders) {
    const timestamp = dueReminderTimestamp(reminder.dueDate, leadDays);
    if (!timestamp) {
      continue;
    }
    try {
      await notifee.createTriggerNotification(
        {
          id: `device-due-${reminder.planId}-${reminder.dueDate}`,
          title: 'Payment due soon',
          body: `${reminder.planNo} — ${formatMoney(reminder.amount)} is due ${formatDate(
            reminder.dueDate,
          )}.`,
          data: {
            planId: reminder.planId,
            kind: 'due',
            scheduledBy: 'due',
          },
          android: {
            channelId: CHANNEL_ID,
            smallIcon: SMALL_ICON,
            color: '#d97706',
            pressAction: {id: 'default', launchActivity: 'default'},
            autoCancel: true,
            groupId: `plan-${reminder.planId}`,
          },
          ios: {
            sound: 'default',
            threadId: `plan-${reminder.planId}`,
          },
        },
        {
          type: TriggerType.TIMESTAMP,
          timestamp,
        },
      );
      scheduled += 1;
    } catch {
      // Keep going if one plan cannot be scheduled.
    }
  }
  return scheduled;
}

/** A quick notification from the profile screen, useful for checking setup. */
export async function sendTestNotification(): Promise<boolean> {
  if ((await notificationPermissionState()) !== 'authorized') {
    return false;
  }
  try {
    await ensureChannel();
    await notifee.displayNotification({
      id: 'device-test',
      title: 'Notifications are on',
      body: 'You will get due-date, payment, and chat alerts here.',
      data: {kind: 'test'},
      android: {
        channelId: CHANNEL_ID,
        smallIcon: SMALL_ICON,
        color: '#6d28d9',
        pressAction: {id: 'default', launchActivity: 'default'},
        autoCancel: true,
      },
      ios: {
        sound: 'default',
        foregroundPresentationOptions: {alert: true, badge: true, sound: true},
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** Re-exported so the navigation layer does not import Notifee directly. */
export {EventType, notifee};
