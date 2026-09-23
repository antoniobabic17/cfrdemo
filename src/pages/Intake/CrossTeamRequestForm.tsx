import { useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Handshake, Loader2, ChevronLeft } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { PageHeader } from '../../components/layout/PageHeader';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import { useResolvedPmoTeamsForIntake, useTeamMemberSearch } from '../../hooks/useIntakeLookups';
import { useCreateProjectRequest } from '../../hooks/useProjectRequests';
import { useChangeAudit } from '../../hooks/useChangeAudit';
import { resolveCurrentUserId } from '../../lib/dataverseClient';
import { writeExtras } from '../../lib/intakeExtras';
import { emitProjectRequestedToTeam } from '../../lib/notify';
import {
  REQUEST_STATUS, REQUEST_TYPE, REQUEST_PRIORITY, SOURCE_SYSTEM,
  LINE_OF_BUSINESS, LINE_OF_BUSINESS_LABELS,
} from '../../lib/constants';
import { toDataverseDateOnly } from '../../lib/dateOnly';
import { toFriendlyError } from '../../lib/utils';
import { toast } from '../../hooks/useToast';

/**
 * Cross-team project request. A member of one team asks ANOTHER team to take on
 * a project. Only the name + target team are required; everything else is
 * optional (the target team fills the rest before converting). Optionally the
 * requester can single out a specific person on the team to notify.
 *
 * On submit: creates a pmo_projectrequest (status Submitted) targeted at the
 * chosen team, then fans out a notification to the whole team (or just the
 * chosen person). The request lands on the target team's Intake Queue (team
 * scoping in selectActionItems) AND stays on the requester's own queue as a
 * tracking row (ownerUserId === me scope).
 */
const PRIORITY_OPTIONS = [
  { value: String(REQUEST_PRIORITY.Critical), label: 'Critical' },
  { value: String(REQUEST_PRIORITY.High), label: 'High' },
  { value: String(REQUEST_PRIORITY.Medium), label: 'Medium' },
  { value: String(REQUEST_PRIORITY.Low), label: 'Low' },
];

const LOB_OPTIONS = [
  { value: String(LINE_OF_BUSINESS.Enteral), label: LINE_OF_BUSINESS_LABELS[LINE_OF_BUSINESS.Enteral] },
  { value: String(LINE_OF_BUSINESS.Infusion), label: LINE_OF_BUSINESS_LABELS[LINE_OF_BUSINESS.Infusion] },
  { value: String(LINE_OF_BUSINESS.Both), label: LINE_OF_BUSINESS_LABELS[LINE_OF_BUSINESS.Both] },
];

export function CrossTeamRequestForm() {
  const navigate = useNavigate();
  const location = useLocation();
  const backTarget = (location.state as { from?: string } | null)?.from === 'intake' ? '/intake' : '/intake/new';

  const teamOptions = useResolvedPmoTeamsForIntake();
  const createRequest = useCreateProjectRequest();
  const auditChange = useChangeAudit();

  const [name, setName] = useState('');
  const [teamId, setTeamId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [description, setDescription] = useState('');
  const [justification, setJustification] = useState('');
  const [priority, setPriority] = useState('');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [lob, setLob] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { searchUsers, resolveUserLabel } = useTeamMemberSearch(teamId);
  const teamName = useMemo(
    () => teamOptions.find((t) => t.value === teamId)?.label,
    [teamOptions, teamId],
  );

  const canSubmit = name.trim().length > 0 && !!teamId && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const currentUserId = await resolveCurrentUserId();
      const payload: Record<string, unknown> = {
        pmo_name: name.trim(),
        pmo_status: REQUEST_STATUS.Submitted,
        pmo_requesttype: REQUEST_TYPE.NewProject,
        pmo_sourcesystem: SOURCE_SYSTEM.CfrPmo,
        'pmo_TargetTeam@odata.bind': `/teams(${teamId})`,
      };
      if (currentUserId) payload['pmo_RequestedBy@odata.bind'] = `/systemusers(${currentUserId})`;
      if (description.trim()) payload.pmo_description = description.trim();
      if (justification.trim()) payload.pmo_businessjustification = justification.trim();
      if (priority) payload.pmo_priority = Number(priority);
      if (startDate) payload.pmo_requestedstartdate = toDataverseDateOnly(startDate);
      if (dueDate) payload.pmo_targetcompletiondate = toDataverseDateOnly(dueDate);
      if (lob) payload.pmo_lineofbusiness = Number(lob);
      // Persist the optional specific assignee in the extras holding pen.
      if (assigneeId) {
        payload.pmo_extractedfieldsjson = writeExtras({}, { requestedForUserId: assigneeId });
      }

      const created = await createRequest.mutateAsync(payload as Parameters<typeof createRequest.mutateAsync>[0]);
      const newId = created.pmo_projectrequestid;

      auditChange({
        entityType: 'intake',
        entityId: newId,
        entityName: name.trim(),
        action: 'create',
      });

      // Fan out the notification: whole team, or just the chosen person.
      void emitProjectRequestedToTeam({
        teamId,
        teamName,
        requestId: newId,
        requestName: name.trim(),
        actorUserId: currentUserId,
        specificUserId: assigneeId || undefined,
      });

      toast.success('Request submitted');
      navigate('/intake');
    } catch (err) {
      toast.error(toFriendlyError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <button
        type="button"
        onClick={() => navigate(backTarget)}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-4 w-4" /> Back
      </button>

      <PageHeader
        title="Request a Project from Another Team"
        subtitle="Ask another team to take on a project. Only a name and the team are required — the team fills in the rest."
      />

      <div className="rounded-lg border border-border bg-card p-6 space-y-5">
        <div className="flex items-center gap-2 pb-1">
          <Handshake className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Request details</h3>
        </div>

        <div className="space-y-1.5">
          <Label>Project name <span className="text-destructive">*</span></Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="What do you need built?" />
        </div>

        <div className="space-y-1.5">
          <Label>Assigned team <span className="text-destructive">*</span></Label>
          <SearchableSelect
            value={teamId}
            onChange={(v) => { setTeamId(v); setAssigneeId(''); }}
            options={teamOptions}
            placeholder="— Select a team —"
          />
        </div>

        {teamId && (
          <div className="space-y-1.5">
            <Label>Assign to a specific person <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <SearchableSelect
              value={assigneeId}
              onChange={setAssigneeId}
              onSearch={searchUsers}
              resolveLabel={resolveUserLabel}
              placeholder="— Anyone on the team —"
            />
            <p className="text-xs text-muted-foreground">
              If you pick someone, only they are notified. Otherwise the whole team is notified.
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Describe what you're asking for." />
        </div>

        <div className="space-y-1.5">
          <Label>Business justification <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={2} placeholder="Why does this matter?" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Priority <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger><SelectValue placeholder="— None —" /></SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Line of business <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Select value={lob} onValueChange={setLob}>
              <SelectTrigger><SelectValue placeholder="— None —" /></SelectTrigger>
              <SelectContent>
                {LOB_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Requested start date <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Target completion date <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => navigate(backTarget)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Handshake className="h-4 w-4 mr-1.5" />}
            Submit Request
          </Button>
        </div>
      </div>
    </div>
  );
}
