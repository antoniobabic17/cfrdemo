import { useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  isSeeAllNotifications,
  setSeeAllNotifications,
  subscribeToSeeAllNotifications,
} from '../../lib/adminAllNotifications';

/**
 * Admin-only toggle: show EVERY notification in the environment (any target
 * user, any category) in the notification center, instead of just the ones
 * addressed to you. Session-only — always OFF on a fresh app load, never
 * persisted. For admin oversight/diagnostics.
 */
export function AllNotificationsSection() {
  const active = useSyncExternalStore(subscribeToSeeAllNotifications, isSeeAllNotifications);
  const qc = useQueryClient();

  function toggle() {
    setSeeAllNotifications(!active);
    // Re-fetch the notification center immediately in the new mode.
    qc.invalidateQueries({ queryKey: ['notifications'] });
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-foreground">See All Notifications (Admin)</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          When on, your notification center shows every notification in the environment —
          regardless of which user it was sent to or its type. For oversight/diagnostics.
          This resets to OFF every time the app loads and is never saved.
        </p>
      </div>

      <div
        className={cn(
          'flex items-center justify-between rounded-lg border p-4 transition-colors',
          active ? 'border-blue-500/50 bg-blue-500/5' : 'border-border bg-card',
        )}
      >
        <div className="flex items-center gap-3">
          <Bell className={cn('h-5 w-5 shrink-0', active ? 'text-blue-500' : 'text-muted-foreground')} />
          <div>
            <p className={cn('text-sm font-medium', active ? 'text-blue-600 dark:text-blue-400' : 'text-foreground')}>
              {active ? 'Showing ALL notifications' : 'Showing only your notifications'}
            </p>
            <p className="text-xs text-muted-foreground">
              {active
                ? 'The notification center is showing every user\u2019s notifications.'
                : 'The notification center is showing only notifications addressed to you.'}
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={active}
          onClick={toggle}
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
            'transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2',
            'focus-visible:ring-ring focus-visible:ring-offset-2',
            active ? 'bg-blue-500' : 'bg-input',
          )}
        >
          <span
            className={cn(
              'pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg',
              'transform transition duration-200 ease-in-out',
              active ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </button>
      </div>
    </div>
  );
}
