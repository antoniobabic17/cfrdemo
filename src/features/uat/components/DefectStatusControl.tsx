/**
 * DefectStatusControl — the full lifecycle, and the dates that go with it.
 *
 * **Eleven statuses, and the four dates are stamped by the transition rather than typed.**
 * `pmo_resolvedon`, `pmo_retestedon` and `pmo_closedon` each mean "when this happened", and a
 * date a person types is a date that can disagree with the status it belongs to. So the status
 * change sets its own date, and the dates are shown read-only beside it.
 *
 * **A retest outcome does NOT drive the case status from here, and that is the point.** T043's
 * acceptance says the case status comes from the new run, not from the defect. So this control
 * records the retest outcome ON the defect and says, in the UI, where the case status comes
 * from — because a control that silently also moved the case would put two writers on one
 * column, which is precisely the legacy rollup-plus-calculated-string failure.
 *
 * `pmo_category` and `pmo_assignedteam` are absent from the table (finding 27) and therefore
 * absent here. An empty picker invites an answer the platform cannot store.
 *
 * **`pmo_assignedto` is a different case, and it IS here.** The two above are option sets whose
 * vocabularies nobody has specified, so the column does not exist. Assignee is a `systemuser`
 * lookup that does exist on `pmo_uatdefect` (verified against Nexus RCM - DEV: `pmo_assignedto`,
 * navigation property `pmo_AssignedTo`, target `systemuser`) and was already being read by
 * `uatDefects.api.ts`. Read and never rendered is the worst of the three states: the acceptance
 * names an assignee, the platform can store one, and the operator had no way to set one. It uses
 * the same org-wide `SearchableSelect` + `useUserSearch` pair every other owner picker in this
 * app uses, so a UAT defect is assigned the way a decision or a gate is.
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Label } from '../../../components/ui/label';
import { SearchableSelect } from '../../../components/common/SearchableSelect';
import { toast } from '../../../hooks/useToast';
import { useUserSearch } from '../../../hooks/useIntakeLookups';
import { useUpdateUatDefect } from '../../../hooks/useUatDefects';
import {
  UAT_DEFECT_STATUS,
  UAT_DEFECT_STATUS_LABELS,
  UAT_DEFECT_SEVERITY,
  UAT_DEFECT_SEVERITY_LABELS,
  UAT_OUTCOME,
  UAT_OUTCOME_LABELS,
  UAT_PRIORITY,
  UAT_PRIORITY_LABELS,
} from '../../../lib/uatOptionSets';
import type { UatDefect, UatDefectUpdate } from '../../../models/uatDefect.model';

/**
 * Which date a status stamps, when it is entered.
 *
 * Declared as data rather than written as a chain of ifs, so "which date does Fixed set" has
 * one answer that a test can read. Statuses that stamp nothing are absent by design: New and
 * Open are the reported state, which `pmo_reportedon` already records at creation.
 */
export const STATUS_DATE_FIELD: Readonly<Record<number, keyof UatDefectUpdate>> = {
  [UAT_DEFECT_STATUS.Fixed]: 'pmo_resolvedon',
  [UAT_DEFECT_STATUS.ReadyForRetest]: 'pmo_resolvedon',
  [UAT_DEFECT_STATUS.RetestFailed]: 'pmo_retestedon',
  [UAT_DEFECT_STATUS.Closed]: 'pmo_closedon',
  [UAT_DEFECT_STATUS.Cancelled]: 'pmo_closedon',
};

export interface DefectStatusControlProps {
  defect: UatDefect;
  projectId: string;
}

export function DefectStatusControl({ defect, projectId }: DefectStatusControlProps) {
  const update = useUpdateUatDefect(projectId);
  const { searchUsers, resolveUserLabel } = useUserSearch();
  const [status, setStatus] = useState<number>(defect.pmo_status ?? UAT_DEFECT_STATUS.New);
  const [severity, setSeverity] = useState<number>(defect.pmo_severity ?? UAT_DEFECT_SEVERITY.Medium);
  const [priority, setPriority] = useState<number>(defect.pmo_priority ?? UAT_PRIORITY.Medium);
  const [retestOutcome, setRetestOutcome] = useState<number | null>(defect.pmo_retestoutcome ?? null);
  const [assignedTo, setAssignedTo] = useState<string>(defect._pmo_assignedto_value ?? '');

  const assignedToChanged = assignedTo !== (defect._pmo_assignedto_value ?? '');
  const dirty = status !== (defect.pmo_status ?? UAT_DEFECT_STATUS.New)
    || severity !== (defect.pmo_severity ?? UAT_DEFECT_SEVERITY.Medium)
    || priority !== (defect.pmo_priority ?? UAT_PRIORITY.Medium)
    || retestOutcome !== (defect.pmo_retestoutcome ?? null)
    || assignedToChanged;

  async function handleSave() {
    const payload: UatDefectUpdate = {
      pmo_status: status,
      pmo_severity: severity,
      pmo_priority: priority,
      pmo_retestoutcome: retestOutcome,
    };
    // The transition stamps its own date, and only when the status actually changed — re-saving
    // a Fixed defect must not move its resolved date to today.
    const dateField = STATUS_DATE_FIELD[status];
    if (dateField && status !== defect.pmo_status) {
      (payload as Record<string, unknown>)[dateField] = new Date().toISOString();
    }
    // Sent only when it actually changed, for the same reason the dates are: a re-save of an
    // unchanged defect should not rewrite a lookup. Cleared means unassigned, so `null` is a
    // real value here and not a "leave it alone".
    if (assignedToChanged) {
      payload['pmo_AssignedTo@odata.bind'] = assignedTo ? `/systemusers(${assignedTo})` : null;
    }

    try {
      await update.mutateAsync({ id: defect.pmo_uatdefectid, payload });
      toast.success(`${defect.pmo_name} is now ${UAT_DEFECT_STATUS_LABELS[status]}.`);
    } catch {
      // useAppMutation toasted and logged it; the local edits stay so the save can be retried.
    }
  }

  const dates: { label: string; value: string | null }[] = [
    { label: 'Reported', value: defect.pmo_reportedon },
    { label: 'Resolved', value: defect.pmo_resolvedon },
    { label: 'Retested', value: defect.pmo_retestedon },
    { label: 'Closed', value: defect.pmo_closedon },
  ];

  return (
    <div className="space-y-3" data-testid="uat-defect-status-control">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor={`status-${defect.pmo_uatdefectid}`}>Status</Label>
          <select
            id={`status-${defect.pmo_uatdefectid}`}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={status}
            onChange={(e) => setStatus(Number(e.target.value))}
          >
            {Object.values(UAT_DEFECT_STATUS).map((value) => (
              <option key={value} value={value}>{UAT_DEFECT_STATUS_LABELS[value]}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`severity-${defect.pmo_uatdefectid}`}>Severity</Label>
          <select
            id={`severity-${defect.pmo_uatdefectid}`}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={severity}
            onChange={(e) => setSeverity(Number(e.target.value))}
          >
            {Object.values(UAT_DEFECT_SEVERITY).map((value) => (
              <option key={value} value={value}>{UAT_DEFECT_SEVERITY_LABELS[value]}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`priority-${defect.pmo_uatdefectid}`}>Priority</Label>
          <select
            id={`priority-${defect.pmo_uatdefectid}`}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
          >
            {Object.values(UAT_PRIORITY).map((value) => (
              <option key={value} value={value}>{UAT_PRIORITY_LABELS[value]}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`retest-${defect.pmo_uatdefectid}`}>Retest outcome</Label>
          <select
            id={`retest-${defect.pmo_uatdefectid}`}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={retestOutcome ?? ''}
            onChange={(e) => setRetestOutcome(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">Not retested</option>
            {Object.values(UAT_OUTCOME).map((value) => (
              <option key={value} value={value}>{UAT_OUTCOME_LABELS[value]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Its own row rather than a fifth column: this one is a search box, and squeezing it beside
          three option sets makes the narrowest control the one that needs the most room. Clearing
          it unassigns — see the null in handleSave.

          `role="group"` + `aria-label` rather than `<Label htmlFor>`: SearchableSelect renders a
          Popover trigger button it does not expose an id for, so htmlFor would point at a div and
          associate nothing. The group carries the accessible name; the Label is the visible one. */}
      <div className="space-y-1.5 sm:max-w-sm" role="group" aria-label="Assignee" data-testid="uat-defect-assignee">
        <Label>Assignee</Label>
        <SearchableSelect
          value={assignedTo}
          onChange={setAssignedTo}
          onSearch={searchUsers}
          resolveLabel={resolveUserLabel}
          placeholder="Unassigned"
        />
      </div>

      {retestOutcome !== null && (
        <p className="text-xs text-muted-foreground">
          {/* Said out loud, because a control that silently also moved the case status would put
              two writers on one column — the legacy rollup failure. */}
          Recorded against this defect. The test case's status comes from its next run, not from
          this outcome — run the case again to move it.
        </p>
      )}

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs" data-testid="uat-defect-dates">
        {dates.map((date) => (
          <div key={date.label}>
            <dt className="text-muted-foreground">{date.label}</dt>
            <dd className="tabular-nums">{date.value ? date.value.slice(0, 10) : '—'}</dd>
          </div>
        ))}
      </dl>

      <Button size="sm" onClick={() => void handleSave()} disabled={!dirty || update.isPending}>
        {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
        Save changes
      </Button>
    </div>
  );
}

export default DefectStatusControl;
