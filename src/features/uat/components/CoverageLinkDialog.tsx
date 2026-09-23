/**
 * CoverageLinkDialog — ONE way to relate a requirement to a test case.
 *
 * **The acceptance is about sameness, not about the dialog.** Linking from the requirement side
 * and linking from the test-case side must produce **one** link row carrying its coverage type —
 * not two rows, and not two mechanisms. So there is one component, one hook, and one payload
 * builder, and the only thing that differs between the two entry points is which end is fixed
 * and which end is chosen. A second dialog for the other direction is how a system ends up with
 * two ways to express one fact, which is what FR-037 forbids and what the legacy model did.
 *
 * The junction has no meaning with one end missing, so both binds are always sent — never one
 * with the other left null.
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { toast } from '../../../hooks/useToast';
import { useCreateUatCoverageLink } from '../../../hooks/useUatTestCases';
import { UAT_ENTITY_SETS } from '../lib/uatEntitySets';
import { UAT_COVERAGE_TYPE, UAT_COVERAGE_TYPE_LABELS } from '../../../lib/uatOptionSets';
import type { UatCoverageLinkCreate } from '../../../models/uatTestCase.model';

/**
 * The ONE payload builder, used by both directions.
 *
 * Exported so a test can assert that the requirement-side and case-side calls produce byte-equal
 * payloads for the same pair — which is the acceptance clause, stated as an equality rather than
 * as two separate assertions that happen to agree today.
 */
export function buildCoverageLink(
  requirementId: string,
  testCaseId: string,
  coverageType: number,
  notes: string,
): UatCoverageLinkCreate {
  return {
    'pmo_Requirement@odata.bind': `/${UAT_ENTITY_SETS.requirement}(${requirementId})`,
    'pmo_TestCase@odata.bind': `/${UAT_ENTITY_SETS.testCase}(${testCaseId})`,
    pmo_coveragetype: coverageType,
    pmo_notes: notes.trim() || null,
  };
}

/** One end is fixed by where the dialog was opened; the other is chosen here. */
export interface CoverageCandidate {
  id: string;
  /** "REQ-1004 · Claim totals must match" — enough to pick the right one. */
  label: string;
}

export interface CoverageLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 'requirement' when opened from a requirement, 'testCase' when opened from a case. */
  from: 'requirement' | 'testCase';
  /** The id of the end that is fixed. */
  fixedId: string;
  /** What the fixed end is, for the description. */
  fixedLabel: string;
  /** The other end's options — requirements when from a case, cases when from a requirement. */
  candidates: readonly CoverageCandidate[];
  onLinked?: () => void;
}

export function CoverageLinkDialog(props: CoverageLinkDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {props.open && <CoverageLinkForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function CoverageLinkForm({
  onOpenChange, from, fixedId, fixedLabel, candidates, onLinked,
}: CoverageLinkDialogProps) {
  const createLink = useCreateUatCoverageLink();
  const [otherId, setOtherId] = useState('');
  const [coverageType, setCoverageType] = useState<number>(UAT_COVERAGE_TYPE.Verifies);
  const [notes, setNotes] = useState('');

  const canSave = otherId !== '' && !createLink.isPending;

  async function handleSave() {
    if (!canSave) return;
    // The ONE place the two directions converge. Whichever end was fixed, the same builder
    // produces the same row.
    const payload = from === 'requirement'
      ? buildCoverageLink(fixedId, otherId, coverageType, notes)
      : buildCoverageLink(otherId, fixedId, coverageType, notes);

    try {
      await createLink.mutateAsync(payload);
      toast.success('Linked.');
      onLinked?.();
      onOpenChange(false);
    } catch {
      // useAppMutation toasted and logged. The form keeps the operator's choices.
    }
  }

  const otherNoun = from === 'requirement' ? 'test case' : 'requirement';

  return (
    <>
      <DialogHeader>
        <DialogTitle>Link a {otherNoun}</DialogTitle>
        <DialogDescription>
          {fixedLabel}. One link row is created, carrying what kind of coverage it is — there is
          only one way to relate a requirement to a test case, whichever side you start from.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="coverage-other">{otherNoun === 'test case' ? 'Test case' : 'Requirement'}</Label>
          <select
            id="coverage-other"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={otherId}
            onChange={(e) => setOtherId(e.target.value)}
          >
            <option value="" disabled>Choose a {otherNoun}…</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
            ))}
          </select>
          {candidates.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nothing left to link — every {otherNoun} on this project is already linked to this
              one.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="coverage-type">Coverage type</Label>
          <select
            id="coverage-type"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={coverageType}
            onChange={(e) => setCoverageType(Number(e.target.value))}
          >
            {Object.values(UAT_COVERAGE_TYPE).map((value) => (
              <option key={value} value={value}>{UAT_COVERAGE_TYPE_LABELS[value]}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Only <strong>Verifies</strong> and <strong>Partially Verifies</strong> count towards
            coverage. <strong>Related</strong> and <strong>Blocks</strong> record a connection
            without claiming the test proves the requirement.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="coverage-notes">Notes (optional)</Label>
          <Textarea
            id="coverage-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createLink.isPending}>
          Cancel
        </Button>
        <Button onClick={() => void handleSave()} disabled={!canSave}>
          {createLink.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          Create the link
        </Button>
      </DialogFooter>
    </>
  );
}

export default CoverageLinkDialog;
