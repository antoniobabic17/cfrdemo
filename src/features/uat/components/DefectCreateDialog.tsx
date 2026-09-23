/**
 * DefectCreateDialog — raise a defect, pre-linked to what found it.
 *
 * **Pre-linking is the point, and it is one link per relationship.** Raised from a failing
 * run, the dialog already knows the test case, the run and the requirement, and writes each as
 * a single-valued lookup. The legacy model expressed a defect's relationship to a test twice —
 * a many-to-many junction AND a shadow lookup — so which one a given row used was ambiguous
 * per row, and that ambiguity is one of the reasons migration is out of scope. Reproducing it
 * would recreate the problem this table exists to avoid.
 *
 * **The case moves to Returned for Defect through the derivation module**, not by naming the
 * status here. `RUN_RESULT_TO_STATUS[Fail]` is the single place that mapping lives, and a
 * source guard in the test asserts this component does not name the status constant directly —
 * because writing the same integer from two places is how the two start to disagree.
 *
 * **No category and no assigned-team picker.** Both columns are absent from the table on
 * purpose (finding 27: the sets exist in the PROD cr87a solution with no members recorded), and
 * an empty picker is worse than no picker — it invites an answer the platform cannot store.
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { SearchableSelect } from '../../../components/common/SearchableSelect';
import { toast } from '../../../hooks/useToast';
import { useUserSearch } from '../../../hooks/useIntakeLookups';
import { useCreateUatDefect } from '../../../hooks/useUatDefects';
import { useUpdateUatTestCase } from '../../../hooks/useUatTestCases';
import { UAT_ENTITY_SETS } from '../lib/uatEntitySets';
import { RUN_RESULT_TO_STATUS } from '../lib/uatStatus';
import {
  UAT_DEFECT_SEVERITY, UAT_DEFECT_SEVERITY_LABELS,
  UAT_DEFECT_STATUS,
  UAT_OUTCOME,
  UAT_PRIORITY, UAT_PRIORITY_LABELS,
} from '../../../lib/uatOptionSets';
import type { UatDefectCreate } from '../../../models/uatDefect.model';

export interface DefectCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** The case this defect was found on. Pre-linked when present. */
  testCaseId?: string | null;
  /** The run that found it. Pre-linked when present. */
  testRunId?: string | null;
  /** The requirement the case covers. Pre-linked when present. */
  requirementId?: string | null;
  /**
   * Move the linked case to Returned for Defect on save. True when raised from a failing run;
   * false when a defect is logged from the list with no case in hand.
   */
  moveCaseToReturned?: boolean;
  onCreated?: (defectId: string) => void;
}

/**
 * The dialog shell. Its body is mounted only while open, which is what discards a half-written
 * defect on cancel — by CONSTRUCTION rather than by an effect that resets each field.
 *
 * The effect version was the first attempt and the lint rule was right to refuse it: resetting
 * state synchronously in an effect cascades renders, and worse, it is a list of fields that can
 * silently fall behind the form (add a field, forget the reset line, and the next dialog opens
 * holding the last attempt's value). Unmounting cannot forget.
 */
export function DefectCreateDialog(props: DefectCreateDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {props.open && <DefectCreateForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function DefectCreateForm({
  onOpenChange,
  projectId,
  testCaseId,
  testRunId,
  requirementId,
  moveCaseToReturned = false,
  onCreated,
}: DefectCreateDialogProps) {
  const [summary, setSummary] = useState('');
  const [details, setDetails] = useState('');
  const [severity, setSeverity] = useState<number>(UAT_DEFECT_SEVERITY.Medium);
  const [priority, setPriority] = useState<number>(UAT_PRIORITY.Medium);
  const [assignedTo, setAssignedTo] = useState('');

  const { searchUsers, resolveUserLabel } = useUserSearch();
  const createDefect = useCreateUatDefect(projectId);
  const updateCase = useUpdateUatTestCase(projectId);

  const canSave = summary.trim().length > 0 && !createDefect.isPending;

  async function handleSave() {
    if (!canSave) return;
    const payload: UatDefectCreate = {
      pmo_summary: summary.trim(),
      pmo_details: details.trim() || null,
      pmo_status: UAT_DEFECT_STATUS.New,
      pmo_severity: severity,
      pmo_priority: priority,
      pmo_reportedon: new Date().toISOString(),
    };
    // One link per relationship, and only the ones we actually have. An absent link is
    // omitted, never sent as an empty bind.
    if (testCaseId) payload['pmo_TestCase@odata.bind'] = `/${UAT_ENTITY_SETS.testCase}(${testCaseId})`;
    if (testRunId) payload['pmo_TestRun@odata.bind'] = `/${UAT_ENTITY_SETS.testRun}(${testRunId})`;
    if (requirementId) payload['pmo_Requirement@odata.bind'] = `/${UAT_ENTITY_SETS.requirement}(${requirementId})`;
    if (assignedTo) payload['pmo_AssignedTo@odata.bind'] = `/systemusers(${assignedTo})`;

    try {
      const defect = await createDefect.mutateAsync(payload);

      // The case status second, and only if the defect exists: a case reading Returned for
      // Defect with no defect to point at is worse than a defect with a stale case status,
      // because the tester cannot act on it.
      if (moveCaseToReturned && testCaseId) {
        try {
          await updateCase.mutateAsync({
            id: testCaseId,
            payload: { pmo_executionstatus: RUN_RESULT_TO_STATUS[UAT_OUTCOME.Fail] },
          });
        } catch {
          // The defect is saved. useAppMutation has already reported this failure; saying so
          // twice would suggest the defect was lost.
          toast.warning('The defect was raised, but the test case status was not updated. '
            + 'Open the case and re-save its run to correct it.');
        }
      }

      toast.success(`${defect.pmo_name || 'Defect'} raised.`);
      onCreated?.(defect.pmo_uatdefectid);
      onOpenChange(false);
    } catch {
      // useAppMutation toasted and logged. The dialog stays open with the text intact.
    }
  }

  const linkCount = [testCaseId, testRunId, requirementId].filter(Boolean).length;

  return (
    <>
        <DialogHeader>
          <DialogTitle>Raise a defect</DialogTitle>
          <DialogDescription>
            {linkCount > 0
              ? 'This defect will be linked to what found it, so the trail from requirement to '
                + 'run to defect stays intact.'
              : 'Not linked to a test case — raise it from a run to link it automatically.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="defect-summary">Summary</Label>
            <Input
              id="defect-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What is wrong, in one line"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="defect-details">Details</Label>
            <Textarea
              id="defect-details"
              rows={4}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="What you did, what happened, what you expected"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="defect-severity">Severity</Label>
              <select
                id="defect-severity"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={severity}
                onChange={(e) => setSeverity(Number(e.target.value))}
              >
                {Object.values(UAT_DEFECT_SEVERITY).map((value) => (
                  <option key={value} value={value}>{UAT_DEFECT_SEVERITY_LABELS[value]}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">How bad it is.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="defect-priority">Priority</Label>
              <select
                id="defect-priority"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
              >
                {Object.values(UAT_PRIORITY).map((value) => (
                  <option key={value} value={value}>{UAT_PRIORITY_LABELS[value]}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">When it needs fixing.</p>
            </div>
          </div>

          {/* Here as well as on DefectStatusControl, deliberately: severity and priority are
              settable at raise time, and an assignee that could only be set afterwards would mean
              every defect starts unowned. Optional — a tester who does not know who owns it leaves
              it blank, and the lifecycle control assigns it later.

              `role="group"` + `aria-label` rather than `<Label htmlFor>`, for the same reason as
              on DefectStatusControl: SearchableSelect exposes no id to point at. */}
          <div className="space-y-1.5" role="group" aria-label="Assignee" data-testid="uat-defect-create-assignee">
            <Label>Assignee</Label>
            <SearchableSelect
              value={assignedTo}
              onChange={setAssignedTo}
              onSearch={searchUsers}
              resolveLabel={resolveUserLabel}
              placeholder="Unassigned"
            />
            <p className="text-xs text-muted-foreground">Who is fixing it, if that is known yet.</p>
          </div>

          {moveCaseToReturned && testCaseId && (
            <p className="text-xs text-muted-foreground">
              Saving this will also move the test case to <strong>Returned for Defect</strong>.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createDefect.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={!canSave}>
            {createDefect.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Raise defect
          </Button>
        </DialogFooter>
    </>
  );
}

export default DefectCreateDialog;
