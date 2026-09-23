/**
 * Team announcement popup — mounted once at the AppShell level so the
 * popup gates the rest of the app on first interaction at session start.
 *
 * Renders one Dialog at a time from the queue of active unacked
 * announcements. Acknowledging advances to the next one, or closes the
 * stack if it's the last. Acks are per-session only (in-memory), so a
 * full refresh re-shows every announcement the user belongs to.
 *
 * Ordering vs global announcement:
 *   The GlobalAnnouncementPopup takes precedence. When a global
 *   announcement is active (enabled + unacked this session), the team
 *   popup is suppressed entirely so only ONE Radix Dialog is open at a
 *   time. Once the user acknowledges (or X'es) the global popup, this
 *   component's next render sees `activeGlobal === null` and the team
 *   queue surfaces. Without this gate, both popups mount simultaneously
 *   and Radix stacks them — the team popup gets buried behind the global
 *   one and never receives focus, which matched the operator report of
 *   the Payer Initiatives announcement never appearing on startup.
 */
import { useQuery } from '@tanstack/react-query';
import { Megaphone } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog';
import { Button } from '../ui/button';
import {
  fetchPmoTeams,
} from '../../lib/pmoTeams';
import { usePmoTeamField } from '../../providers/ConfigurationProvider';
import { useActiveAnnouncementsForCurrentUser } from '../../hooks/useTeamAnnouncement';
import { markAcked } from '../../lib/teamAnnouncementAcks';
import { useRecordAnnouncementAck } from '../../hooks/useAnnouncementAcks';
import { useActiveGlobalAnnouncement } from '../../hooks/useGlobalAnnouncement';

interface TeamRow {
  teamid: string;
  name: string;
}

export function TeamAnnouncementPopup() {
  const active = useActiveAnnouncementsForCurrentUser();
  const recordAck = useRecordAnnouncementAck();
  // Suppress ourselves while a global announcement is on screen. See the
  // "Ordering vs global announcement" note in the file header.
  const activeGlobal = useActiveGlobalAnnouncement();

  // Resolve team names so the popup header can read "Business Intelligence
  // wants you to know..." rather than a GUID. The PMO teams query is the
  // same one TeamsPage uses; cache is shared.
  const pmoTeamField = usePmoTeamField();
  const { data: teams = [] } = useQuery({
    queryKey: ['systemTeams', pmoTeamField],
    queryFn: () => fetchPmoTeams<TeamRow>(pmoTeamField, ['teamid', 'name']),
    enabled: active.length > 0 && !activeGlobal,
    staleTime: 5 * 60 * 1000,
  });

  if (activeGlobal) return null;

  const current = active[0];
  if (!current) return null;

  const teamName = teams.find((t) => t.teamid === current.teamId)?.name ?? 'Your team';

  function handleAck() {
    // Every-Load: session ack (reappears next load). Single-Time: persist
    // per-user so this member is never asked again for this version.
    if (current.ackMode === 'single') {
      recordAck.mutate({ scope: `team:${current.teamId}`, version: current.version });
    } else {
      markAcked(current.teamId, current.version);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) handleAck(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-primary" />
            {current.title || `Announcement from ${teamName}`}
          </DialogTitle>
          <DialogDescription className="pt-1 text-xs text-muted-foreground">
            From <span className="font-medium text-foreground">{teamName}</span>
            {active.length > 1 && (
              <span className="ml-2">· {active.length} announcements queued</span>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed py-2 max-h-[60vh] overflow-y-auto space-y-3">
          {current.body || (!current.bodyGifUrl && (
            <span className="italic text-muted-foreground">
              (No body provided — your team lead enabled the announcement but did not author content yet.)
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
