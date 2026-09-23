import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import type { Notification } from '../../models/notification.model';

interface Props {
  open: boolean;
  notification: Notification | null;
  onClose: () => void;
  /** Optional label for the notification category (e.g. "Decision"). */
  categoryLabel?: string;
}

/**
 * Read-only detail view for a notification. Used for "informational"
 * notifications that have nowhere useful to navigate — feedback resolved /
 * on-hold decisions to the submitter — whose full content (status, who
 * completed it, and the admin response) lives in pmo_body. The body is
 * rendered with preserved whitespace so the "Admin response:" block reads
 * naturally. No navigation; a single Close button dismisses it.
 */
export function NotificationDetailDialog({ open, notification, onClose, categoryLabel }: Props) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{notification?.pmo_title ?? 'Notification'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {categoryLabel && <span className="font-medium">{categoryLabel}</span>}
            {notification?.createdon && (
              <span>{new Date(notification.createdon).toLocaleString()}</span>
            )}
          </div>
          {notification?.pmo_body ? (
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
              {notification.pmo_body}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No additional details.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
