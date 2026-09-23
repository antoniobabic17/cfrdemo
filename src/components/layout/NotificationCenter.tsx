import { Bell, Check, X, Circle } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../ui/sheet';
import { Button } from '../ui/button';
import { useNotifications, useUnreadCount, useMarkAsRead, useDismissNotification } from '../../hooks/useNotifications';
import { useConfig } from '../../providers/ConfigurationProvider';
import { NOTIF_CATEGORY } from '../../lib/constants';
import { useSyncExternalStore } from 'react';
import { isSeeAllNotifications, subscribeToSeeAllNotifications } from '../../lib/adminAllNotifications';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { NotificationDetailDialog } from '../common/NotificationDetailDialog';
import { isInformationalNotification } from '../../lib/actionItems';
import { notificationToActionItem } from '../../lib/actionItems';
import type { Notification } from '../../models/notification.model';

const DEFAULT_CATEGORY_LABELS: Record<number, string> = {
  [NOTIF_CATEGORY.Gate]: 'Gate',
  [NOTIF_CATEGORY.Artifact]: 'Artifact',
  [NOTIF_CATEGORY.Closeout]: 'Closeout',
  [NOTIF_CATEGORY.Meeting]: 'Meeting',
  [NOTIF_CATEGORY.Error]: 'Error',
  [NOTIF_CATEGORY.Info]: 'Info',
  [NOTIF_CATEGORY.TaskAssigned]: 'Task Assigned',
  [NOTIF_CATEGORY.ClarificationRequested]: 'Clarification',
  [NOTIF_CATEGORY.RequestSubmitted]: 'Request Submitted',
  [NOTIF_CATEGORY.RequestDecision]: 'Decision',
};

const DEFAULT_CATEGORY_COLORS: Record<number, string> = {
  [NOTIF_CATEGORY.Error]: 'text-rose-500',
  [NOTIF_CATEGORY.Gate]: 'text-amber-500',
  [NOTIF_CATEGORY.Meeting]: 'text-blue-500',
  [NOTIF_CATEGORY.TaskAssigned]: 'text-indigo-500',
  [NOTIF_CATEGORY.ClarificationRequested]: 'text-amber-500',
  [NOTIF_CATEGORY.RequestDecision]: 'text-emerald-500',
};

export function NotificationCenter() {
  const { data: notifications = [] } = useNotifications();
  const seeAll = useSyncExternalStore(subscribeToSeeAllNotifications, isSeeAllNotifications);
  const unread = useUnreadCount();
  const markRead = useMarkAsRead();
  const dismiss = useDismissNotification();
  const { config: { notificationDisplay } } = useConfig();

  const categoryLabel = (v: number) =>
    notificationDisplay.categoryLabels[String(v)] ??
    DEFAULT_CATEGORY_LABELS[v] ??
    'Info';

  const categoryColor = (v: number) =>
    notificationDisplay.categoryColors[String(v)] ??
    DEFAULT_CATEGORY_COLORS[v] ??
    'text-muted-foreground';

  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [detailNotif, setDetailNotif] = useState<Notification | null>(null);

  // Clicking a notification: informational ones (feedback resolved / on-hold,
  // which have no reachable detail page for the submitter) open a read-only
  // detail dialog; ones with a real action url navigate and close the sheet.
  // Either way an unread notification is marked read.
  function handleOpenNotification(n: Notification) {
    if (!n.pmo_isread) markRead.mutate(n.pmo_notificationid);
    if (isInformationalNotification(notificationToActionItem(n))) {
      setDetailNotif(n);
      return;
    }
    if (n.pmo_actionurl) {
      setSheetOpen(false);
      navigate(n.pmo_actionurl, { state: { from: 'notifications' } });
    }
  }

  return (
    <>
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
      <SheetTrigger asChild>
        <button type="button" className="relative p-2 rounded-md hover:bg-muted/60 transition-colors">
          <Bell className="h-4.5 w-4.5 text-muted-foreground" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-rose-500 text-[10px] font-bold text-white flex items-center justify-center">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-80 sm:w-96">
        <SheetHeader>
          <SheetTitle>Notifications</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-2 max-h-[calc(100vh-8rem)] overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No notifications</p>
          ) : (
            notifications.map((n) => (
              <div
                key={n.pmo_notificationid}
                role="button"
                tabIndex={0}
                onClick={() => handleOpenNotification(n)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpenNotification(n); } }}
                className={`rounded-lg border p-3 text-sm cursor-pointer hover:border-primary/40 transition-colors ${n.pmo_isread ? 'bg-card' : 'bg-primary/5 border-primary/20'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {!n.pmo_isread && <Circle className="h-2 w-2 fill-primary text-primary shrink-0" />}
                    <span className="font-medium text-foreground truncate">{n.pmo_title}</span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {!n.pmo_isread && (
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); markRead.mutate(n.pmo_notificationid); }}>
                        <Check className="h-3 w-3" />
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); dismiss.mutate(n.pmo_notificationid); }}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                {n.pmo_body && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{n.pmo_body}</p>}
                <div className="flex items-center gap-2 mt-1.5">
                  <span className={`text-[10px] font-medium ${categoryColor(n.pmo_category)}`}>
                    {categoryLabel(n.pmo_category)}
                  </span>
                  {n.createdon && (
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(n.createdon).toLocaleDateString()}
                    </span>
                  )}
                  {seeAll && n['_pmo_targetuser_value@OData.Community.Display.V1.FormattedValue'] && (
                    <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400">
                      For: {n['_pmo_targetuser_value@OData.Community.Display.V1.FormattedValue']}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
    <NotificationDetailDialog
      open={detailNotif !== null}
      notification={detailNotif}
      categoryLabel={detailNotif ? categoryLabel(detailNotif.pmo_category) : undefined}
      onClose={() => setDetailNotif(null)}
    />
    </>
  );
}
