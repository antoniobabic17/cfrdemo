import { Calendar, ExternalLink } from 'lucide-react';
import type { ProjectMeetingLink } from '../../models/projectMeetingLink.model';

interface MeetingSummaryCardProps {
  meeting: ProjectMeetingLink;
}

export function MeetingSummaryCard({ meeting }: MeetingSummaryCardProps) {
  const dt = new Date(meeting.pmo_meetingdatetime);
  const isPast = dt < new Date();

  return (
    <div className={`rounded-lg border bg-card p-3 text-sm ${isPast ? 'opacity-70' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground truncate">{meeting.pmo_meetingsubject}</p>
          <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            <span>{dt.toLocaleDateString()} {dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            {isPast && <span className="text-muted-foreground/60">Past</span>}
          </div>
        </div>
        {meeting.pmo_meetingurl && (
          <a href={meeting.pmo_meetingurl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline shrink-0">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      {meeting.pmo_notes && (
        <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{meeting.pmo_notes}</p>
      )}
    </div>
  );
}
