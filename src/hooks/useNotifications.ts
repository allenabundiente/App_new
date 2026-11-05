/**
 * Hooks that connect the notification service to the React app.
 *
 * `useNotificationRouting` opens the plan behind a tapped notification.
 * `useDueNotifications` schedules the next due payment for buyers.
 */
import {useEffect, useRef} from 'react';
import {AppState} from 'react-native';
import type {Plan} from '../types';
import {getSettings, scheduleForPlan} from '../db/dataAccess';
import {
  cancelScheduledDueNotifications,
  notificationTarget,
  notifee,
  EventType,
  scheduleDueReminders,
  type DueReminder,
} from '../services/notifications';
import {
  consumeNotificationPress,
  type NotificationPressTarget,
} from '../services/notificationPress';
import {useAppStore} from '../store/AppStore';

export function useNotificationRouting(): void {
  const {user, push} = useAppStore();
  const handled = useRef(new Set<string>());

  useEffect(() => {
    if (!user) {
      return;
    }

    const open = (target: NotificationPressTarget | null) => {
      if (!target) {
        return;
      }
      const key = target.notificationId || `${target.planId}:${target.openChat ? 'chat' : 'plan'}`;
      if (handled.current.has(key)) {
        return;
      }
      handled.current.add(key);
      push('plan-detail', {planId: target.planId, openChat: target.openChat});
    };

    // A tap that happened while the app was killed is waiting in storage.
    open(consumeNotificationPress());

    // Taps while the app is in the foreground arrive as an event.
    const unsubscribe = notifee.onForegroundEvent(({type, detail}) => {
      if (type !== EventType.PRESS) {
        return;
      }
      const target = notificationTarget(detail.notification);
      open(
        target
          ? {...target, notificationId: detail.notification?.id}
          : null,
      );
    });

    // A tap while the app is backgrounded is handled by the background
    // handler in index.js. Coming back to the foreground is our cue to read it.
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        open(consumeNotificationPress());
      }
    });

    return () => {
      unsubscribe();
      sub.remove();
    };
  }, [user, push]);
}

export function useDueNotifications(plans: Plan[]): void {
  const {user, tick} = useAppStore();

  useEffect(() => {
    if (!user || user.role !== 'buyer') {
      return;
    }
    let alive = true;
    (async () => {
      try {
        const [settings, schedules] = await Promise.all([
          getSettings(),
          Promise.all(
            plans
              .filter(plan => plan.status === 'active')
              .map(async plan => {
                const rows = await scheduleForPlan(plan.id);
                const next = rows
                  .filter(row => row.status === 'pending' && row.amount - row.paidAmount > 0)
                  .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
                if (!next) {
                  return null;
                }
                const reminder: DueReminder = {
                  planId: plan.id,
                  planNo: plan.planNo,
                  dueDate: next.dueDate,
                  amount: next.amount - next.paidAmount,
                };
                return reminder;
              }),
          ),
        ]);
        if (!alive) {
          return;
        }
        await scheduleDueReminders(
          schedules.filter((row): row is DueReminder => row !== null),
          settings.reminderLead,
        );
      } catch {
        // Keep any reminders that were already scheduled when the network
        // or the settings endpoint is temporarily unavailable.
      }
    })();

    return () => {
      alive = false;
    };
  }, [plans, tick, user]);

  // Leaving the signed-in shell (logout) removes this buyer's reminders.
  useEffect(
    () => () => {
      void cancelScheduledDueNotifications();
    },
    [],
  );
}
