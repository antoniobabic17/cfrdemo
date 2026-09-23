import { useState, useMemo } from 'react';
import { Calendar, Plus, ExternalLink, ChevronDown, ChevronUp, Loader2, Users, Clock, MessageSquare } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { useProjectMeetingLinks, useCreateProjectMeetingLink, useUpdateProjectMeetingLink } from '../../hooks/useProjectMeetingLinks';
import { useProjectDecisions } from '../../hooks/useProjectDecisions';
import { useCreateProjectDecision } from '../../hooks/useProjectDecisions';
import { isGraphAvailable, createCalendarEvent } from '../../lib/graphClient';
import { DECISION_STATUS } from '../../lib/constants';
import { toast } from '../../hooks/useToast';
import { cn } from '../../lib/utils';
import type { ProjectMeetingLink } from '../../models/projectMeetingLink.model';
import { READ_ONLY_TOOLTIP } from '../../hooks/useProjectPermissions';
import { toDataverseDateOnly, todayLocalYmd } from '../../lib/dateOnly';

interface MeetingWorkspaceProps {
  projectId: string;
  canEdit?: boolean;
}

export function MeetingWorkspace({ projectId, canEdit = true }: MeetingWorkspaceProps) {
  const { data: meetings = [], isLoading } = useProjectMeetingLinks(projectId);
  const createMeeting = useCreateProjectMeetingLink(projectId);
  const updateMeeting = useUpdateProjectMeetingLink(projectId);
  const { data: decisions = [] } = useProjectDecisions(projectId);
  const createDecision = useCreateProjectDecision(projectId);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionMeetingId, setActionMeetingId] = useState<string | null>(null);
  const [actionText, setActionText] = useState('');

  // Schedule form state
  const [subject, setSubject] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [location, setLocation] = useState('');
  const [agenda, setAgenda] = useState('');
  const [useTeams, setUseTeams] = useState(true);
  const [scheduling, setScheduling] = useState(false);

  const now = new Date();
  const upcoming = useMemo(() => meetings.filter((m) => new Date(m.pmo_meetingdatetime) >= now).sort((a, b) => new Date(a.pmo_meetingdatetime).getTime() - new Date(b.pmo_meetingdatetime).getTime()), [meetings]);
  const past = useMemo(() => meetings.filter((m) => new Date(m.pmo_meetingdatetime) < now).sort((a, b) => new Date(b.pmo_meetingdatetime).getTime() - new Date(a.pmo_meetingdatetime).getTime()), [meetings]);

  async function handleSchedule() {
    if (!subject.trim() || !startDate) return;
    setScheduling(true);
    try {
      const startDt = `${startDate}T${startTime}:00`;
      const endDt = `${startDate}T${endTime}:00`;
      let graphEventId: string | undefined;
      let teamsUrl: string | undefined;

      const graphOk = await isGraphAvailable();
      if (graphOk) {
        try {
          const event = await createCalendarEvent({
            subject: subject.trim(),
            startDateTime: startDt,
            endDateTime: endDt,
            location: location.trim() || undefined,
            isOnlineMeeting: useTeams,
          });
          graphEventId = event.id;
          teamsUrl = event.joinUrl || undefined;
        } catch {
          toast.info('Calendar event could not be created — meeting saved locally');
        }
      }

      const durationMinutes = (new Date(endDt).getTime() - new Date(startDt).getTime()) / 60000;

      await createMeeting.mutateAsync({
        pmo_name: subject.trim(),
        pmo_meetingsubject: subject.trim(),
        pmo_meetingdatetime: startDt,
        pmo_meetingurl: teamsUrl,
        pmo_grapheventid: graphEventId,
        pmo_duration: durationMinutes > 0 ? durationMinutes : undefined,
        pmo_location: location.trim() || undefined,
        pmo_agendanotes: agenda.trim() || undefined,
        'pmo_Project@odata.bind': `/msdyn_projects(${projectId})`,
      });
      toast.success('Meeting scheduled');
      setScheduleOpen(false);
      resetForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to schedule meeting');
    } finally {
      setScheduling(false);
    }
  }

  function resetForm() {
    setSubject(''); setStartDate(''); setStartTime('09:00'); setEndTime('10:00');
    setLocation(''); setAgenda(''); setUseTeams(true);
  }

  async function handleSaveSummary(meetingId: string, summary: string) {
    await updateMeeting.mutateAsync({ id: meetingId, payload: { pmo_summary: summary } });
    toast.success('Summary saved');
  }

  async function handleCaptureAction() {
    if (!actionText.trim() || !actionMeetingId) return;
    await createDecision.mutateAsync({
      pmo_name: actionText.trim(),
      pmo_description: actionText.trim(),
      pmo_decisiondate: toDataverseDateOnly(todayLocalYmd())!,
      pmo_status: DECISION_STATUS.Proposed,
      'pmo_Project@odata.bind': `/msdyn_projects(${projectId})`,
      'pmo_MeetingLink@odata.bind': `/pmo_projectmeetinglinks(${actionMeetingId})`,
    });
    toast.success('Action captured as decision');
    setActionText('');
    setActionMeetingId(null);
  }

  function MeetingCard({ meeting, isPast }: { meeting: ProjectMeetingLink; isPast: boolean }) {
    const expanded = expandedId === meeting.pmo_projectmeetinglinkid;
    const dt = new Date(meeting.pmo_meetingdatetime);
    const linkedDecisions = decisions.filter((d) => d['_pmo_meetinglink_value'] === meeting.pmo_projectmeetinglinkid);
    const attendees: Array<{ name: string; response: string }> = meeting.pmo_attendeesjson ? (() => { try { return JSON.parse(meeting.pmo_attendeesjson); } catch { return []; } })() : [];

    return (
      <div className={cn('rounded-lg border bg-card', isPast && 'opacity-70')}>
        <button type="button" className="w-full text-left px-4 py-3 flex items-center gap-3" onClick={() => setExpandedId(expanded ? null : meeting.pmo_projectmeetinglinkid)}>
          <Calendar className={cn('h-4 w-4 shrink-0', isPast ? 'text-muted-foreground' : 'text-primary')} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{meeting.pmo_meetingsubject}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
              <span>{dt.toLocaleDateString()} {dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              {meeting.pmo_duration && <span><Clock className="h-3 w-3 inline" /> {meeting.pmo_duration}m</span>}
              {attendees.length > 0 && <span><Users className="h-3 w-3 inline" /> {attendees.length}</span>}
              {linkedDecisions.length > 0 && <span className="text-primary">{linkedDecisions.length} actions</span>}
            </div>
          </div>
          {meeting.pmo_meetingurl && (
            <a href={meeting.pmo_meetingurl} target="_blank" rel="noopener noreferrer" className="text-primary shrink-0" onClick={(e) => e.stopPropagation()}>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
        </button>

        {expanded && (
          <div className="px-4 pb-4 border-t space-y-3 pt-3">
            {meeting.pmo_location && <p className="text-xs text-muted-foreground">Location: {meeting.pmo_location}</p>}

            {attendees.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Attendees</p>
                <div className="flex flex-wrap gap-1">
                  {attendees.map((a, i) => (
                    <span key={i} className={cn('text-[10px] px-2 py-0.5 rounded-full border', a.response === 'accepted' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : a.response === 'declined' ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-border bg-muted text-muted-foreground')}>
                      {a.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {meeting.pmo_agendanotes && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Agenda</p>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{meeting.pmo_agendanotes}</p>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Summary</p>
              <textarea
                defaultValue={meeting.pmo_summary ?? ''}
                onBlur={(e) => {
                  if (e.target.value !== (meeting.pmo_summary ?? '')) handleSaveSummary(meeting.pmo_projectmeetinglinkid, e.target.value);
                }}
                rows={3}
                placeholder="Post-meeting summary..."
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            {linkedDecisions.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Actions ({linkedDecisions.length})</p>
                {linkedDecisions.map((d) => (
                  <div key={d.pmo_projectdecisionid} className="text-xs text-foreground py-0.5">{d.pmo_name}</div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => { setActionMeetingId(meeting.pmo_projectmeetinglinkid); }} disabled={!canEdit} title={!canEdit ? READ_ONLY_TOOLTIP : undefined}>
                <MessageSquare className="h-3.5 w-3.5 mr-1" />Capture Action
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground">Meetings</h3>
        <Button size="sm" onClick={() => setScheduleOpen(true)} disabled={!canEdit} title={!canEdit ? READ_ONLY_TOOLTIP : undefined}>
          <Plus className="h-3.5 w-3.5 mr-1" />Schedule Meeting
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading meetings...</div>
      ) : meetings.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed p-8 text-center">
          <Calendar className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
          <p className="text-sm font-medium text-foreground">No meetings linked</p>
          <p className="text-xs text-muted-foreground mt-1">Schedule a meeting to link it to this project</p>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Upcoming ({upcoming.length})</p>
              {upcoming.map((m) => <MeetingCard key={m.pmo_projectmeetinglinkid} meeting={m} isPast={false} />)}
            </div>
          )}
          {past.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Past ({past.length})</p>
              {past.slice(0, 10).map((m) => <MeetingCard key={m.pmo_projectmeetinglinkid} meeting={m} isPast={true} />)}
            </div>
          )}
        </>
      )}

      {/* Schedule Meeting Dialog */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Schedule Meeting</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><label className="text-sm font-medium">Subject *</label><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Meeting subject" /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><label className="text-sm font-medium">Date *</label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
              <div><label className="text-sm font-medium">Start</label><Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
              <div><label className="text-sm font-medium">End</label><Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
            </div>
            <div><label className="text-sm font-medium">Location</label><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={useTeams} onChange={(e) => setUseTeams(e.target.checked)} className="rounded" />Add Teams meeting link</label>
            <div><label className="text-sm font-medium">Agenda</label>
              <textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={3} placeholder="Meeting agenda and prep notes..." className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
            </div>
            <Button size="sm" onClick={handleSchedule} disabled={scheduling || !subject.trim() || !startDate}>
              {scheduling ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}Schedule
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Action Capture Dialog */}
      <Dialog open={!!actionMeetingId} onOpenChange={(o) => { if (!o) setActionMeetingId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Capture Action</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input value={actionText} onChange={(e) => setActionText(e.target.value)} placeholder="Action item description" />
            <Button size="sm" onClick={handleCaptureAction} disabled={!actionText.trim()}>Capture as Decision</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
