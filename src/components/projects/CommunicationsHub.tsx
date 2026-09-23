import { useState } from 'react';
import { MessageSquare, Plus, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { DocumentLibrary } from './DocumentLibrary';
import { MeetingSummaryCard } from '../meetings/MeetingSummaryCard';
import { useProjectMeetingLinks, useCreateProjectMeetingLink } from '../../hooks/useProjectMeetingLinks';
import { useNotifications } from '../../hooks/useNotifications';
import { toast } from '../../hooks/useToast';

interface CommunicationsHubProps {
  projectId: string;
  projectName?: string;
}

export function CommunicationsHub({ projectId, projectName }: CommunicationsHubProps) {
  const { data: meetings = [] } = useProjectMeetingLinks(projectId);
  const { data: notifications = [] } = useNotifications();
  const createMeeting = useCreateProjectMeetingLink(projectId);
  const [addMeetingOpen, setAddMeetingOpen] = useState(false);
  const [meetingSubject, setMeetingSubject] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');

  const projectNotifications = notifications.filter(
    (n) => n['_pmo_project_value'] === projectId,
  );

  async function handleAddMeeting() {
    if (!meetingSubject.trim() || !meetingDate) return;
    await createMeeting.mutateAsync({
      pmo_name: meetingSubject.trim(),
      pmo_meetingsubject: meetingSubject.trim(),
      pmo_meetingdatetime: meetingDate,
      pmo_meetingurl: meetingUrl.trim() || undefined,
      'pmo_Project@odata.bind': `/msdyn_projects(${projectId})`,
    });
    toast.success('Meeting linked');
    setAddMeetingOpen(false);
    setMeetingSubject('');
    setMeetingDate('');
    setMeetingUrl('');
  }

  return (
    <div className="space-y-6">
      <DocumentLibrary recordType="Project" recordId={projectId} recordName={projectName ?? ''} projectId={projectId} compact />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <MessageSquare className="h-4 w-4" />
            Meetings ({meetings.length})
          </h4>
          <Button size="sm" variant="outline" onClick={() => setAddMeetingOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Link Meeting
          </Button>
        </div>
        {meetings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No meetings linked.</p>
        ) : (
          <div className="space-y-2">
            {meetings.map((m) => (
              <MeetingSummaryCard key={m.pmo_projectmeetinglinkid} meeting={m} />
            ))}
          </div>
        )}
      </div>

      {projectNotifications.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-foreground">Recent Notifications ({projectNotifications.length})</h4>
          {projectNotifications.slice(0, 5).map((n) => (
            <div key={n.pmo_notificationid} className="rounded-md border bg-card p-2.5 text-sm">
              <p className="font-medium text-foreground">{n.pmo_title}</p>
              {n.pmo_body && <p className="text-xs text-muted-foreground mt-0.5">{n.pmo_body}</p>}
            </div>
          ))}
        </div>
      )}

      <Dialog open={addMeetingOpen} onOpenChange={setAddMeetingOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Link Meeting</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Subject</label>
              <Input value={meetingSubject} onChange={(e) => setMeetingSubject(e.target.value)} placeholder="Meeting subject" />
            </div>
            <div>
              <label className="text-sm font-medium">Date/Time</label>
              <Input type="datetime-local" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium">Teams URL (optional)</label>
              <Input value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} placeholder="https://teams.microsoft.com/..." />
            </div>
            <Button size="sm" onClick={handleAddMeeting} disabled={createMeeting.isPending || !meetingSubject.trim() || !meetingDate}>
              {createMeeting.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Link
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
