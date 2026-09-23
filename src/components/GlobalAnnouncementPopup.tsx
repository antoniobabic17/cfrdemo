import { Megaphone } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { useActiveGlobalAnnouncement } from '../hooks/useGlobalAnnouncement';
import { markGlobalAcked } from '../lib/globalAnnouncementAcks';
import { useRecordAnnouncementAck } from '../hooks/useAnnouncementAcks';

export function GlobalAnnouncementPopup() {
  const current = useActiveGlobalAnnouncement();
  const recordAck = useRecordAnnouncementAck();
  if (!current) return null;

  function handleAck() {
    // Every-Load mode: session ack only (reappears next load). Single-Time:
    // persist to Dataverse so the user is never asked again for this version.
    if (current!.ackMode === 'single') {
      recordAck.mutate({ scope: 'global', version: current!.version });
    } else {
      markGlobalAcked(current!.version);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) handleAck(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-primary" />
            {current.title || 'Announcement'}
          </DialogTitle>
          <DialogDescription className="pt-1 text-xs text-muted-foreground">
            From <span className="font-medium text-foreground">Administration</span>
          </DialogDescription>
        </DialogHeader>
        <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed py-2 max-h-[60vh] overflow-y-auto space-y-3">
          {current.body || (!current.bodyGifUrl && (
            <span className="italic text-muted-foreground">
              (No body provided — an admin enabled the announcement but did not author content yet.)
            </span>
          ))}
          {current.bodyGifUrl && (
            <img
              src={current.bodyGifUrl}
              alt="Announcement GIF"
              className="max-h-72 rounded-md border border-border"
            />
          )}
        </div>
        <DialogFooter>
          <Button size="sm" onClick={handleAck}>Acknowledge</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
