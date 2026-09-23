/**
 * RequirementDetailPage — one requirement, its parent, its coverage links, its evidence.
 *
 * **Re-parenting is offered here and is a real operation** (T047: "displays and re-parents"),
 * unlike a test case's project, which is refused. The difference is not arbitrary: a
 * requirement's parent is `pmo_parent`, RemoveLink and self-referential, and moving a story
 * between epics changes nothing else. A test case's project is duplicated onto its runs so that
 * portfolio rollups need no join, so moving one leaves two references to reconcile — which is
 * why `useUpdateUatTestCase` strips project binds and this page happily changes a parent.
 *
 * **The parent choices exclude the requirement itself and its own children**, because a
 * requirement cannot be its own ancestor and a two-level model has nowhere to put a grandchild.
 *
 * This is also the Requirement evidence surface — T032's last deferred mount.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Link2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Label } from '../../../components/ui/label';
import { toast } from '../../../hooks/useToast';
import {
  useUatRequirement, useUatRequirements, useReparentUatRequirement,
} from '../../../hooks/useUatRequirements';
import { useCoverageForRequirement, useAllUatTestCases } from '../../../hooks/useUatTestCases';
import { CoverageLinkDialog } from '../components/CoverageLinkDialog';
import { UatEvidenceFor } from '../components/UatAttachmentMounts';
import {
  UAT_COVERAGE_TYPE_LABELS,
  UAT_REQUIREMENT_TYPE_LABELS,
  UAT_REQUIREMENT_STATUS_LABELS,
} from '../../../lib/uatOptionSets';
import { readProjectValue } from '../../../lib/projectLookupRef';

export function RequirementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [linkOpen, setLinkOpen] = useState(false);

  const { data: requirement, isPending, isError, refetch } = useUatRequirement(id);
  const projectId = requirement ? readProjectValue(requirement) ?? '' : '';
  const { data: siblings = [] } = useUatRequirements(projectId || undefined);
  const { data: coverage = [], refetch: refetchCoverage } = useCoverageForRequirement(id);
  const { data: allCases = [] } = useAllUatTestCases();
  const reparent = useReparentUatRequirement(projectId);

  /** Cases on this project that are not already linked — the dialog's candidate list. */
  const candidates = useMemo(() => {
    const linked = new Set(coverage.map((link) => link._pmo_testcase_value));
    return allCases
      .filter((c) => readProjectValue(c) === projectId && !linked.has(c.pmo_uattestcaseid))
      .map((c) => ({ id: c.pmo_uattestcaseid, label: `${c.pmo_name} · ${c.pmo_title}` }));
  }, [allCases, coverage, projectId]);

  /**
   * Valid parents: anything on this project except this requirement and its own children.
   * A requirement cannot be its own ancestor, and a two-level model has no grandchildren.
   */
  const parentChoices = useMemo(
    () => siblings.filter((r) =>
      r.pmo_uatrequirementid !== id && r._pmo_parent_value !== id),
    [siblings, id],
  );

  async function handleReparent(parentId: string) {
    if (!id) return;
    try {
      await reparent.mutateAsync({ id, parentId: parentId || null });
      toast.success(parentId ? 'Moved under its new parent.' : 'Promoted to top level.');
    } catch {
      // useAppMutation toasted and logged it.
    }
  }

  if (isPending) {
    return (
      <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading the requirement…
      </div>
    );
  }
  if (isError || !requirement) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-destructive" role="alert">
          This requirement could not be loaded. It may have been deleted.
        </p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>Try again</Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">
            {requirement.pmo_name} · {requirement.pmo_title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {UAT_REQUIREMENT_TYPE_LABELS[requirement.pmo_type ?? -1] ?? 'Requirement'} ·{' '}
            {UAT_REQUIREMENT_STATUS_LABELS[requirement.pmo_status ?? -1] ?? 'No status'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(`/uat/requirements?projectId=${projectId}`)}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden /> All requirements
        </Button>
      </div>

      {requirement.pmo_description && (
        <p className="text-sm whitespace-pre-wrap">{requirement.pmo_description}</p>
      )}
      {requirement.pmo_acceptancecriteria && (
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Acceptance criteria
          </h2>
          <p className="text-sm whitespace-pre-wrap mt-1">{requirement.pmo_acceptancecriteria}</p>
        </div>
      )}

      <div className="space-y-1.5 max-w-md">
        <Label htmlFor="req-parent">Parent</Label>
        <select
          id="req-parent"
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={requirement._pmo_parent_value ?? ''}
          disabled={reparent.isPending}
          onChange={(e) => void handleReparent(e.target.value)}
        >
          <option value="">No parent (top level)</option>
          {parentChoices.map((choice) => (
            <option key={choice.pmo_uatrequirementid} value={choice.pmo_uatrequirementid}>
              {choice.pmo_name} · {choice.pmo_title}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Moving this under another requirement changes nothing else — a requirement's parent is
          its own reference, not a copy held anywhere.
        </p>
      </div>

      <section className="space-y-3" aria-label="Coverage">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Test cases covering this
          </h2>
          <Button size="sm" variant="outline" onClick={() => setLinkOpen(true)}>
            <Link2 className="mr-1.5 h-4 w-4" aria-hidden /> Link a test case
          </Button>
        </div>

        {coverage.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing covers this requirement yet — it counts as untested.
          </p>
        ) : (
          <div className="rounded-md border border-border">
            <table className="w-full text-sm" data-testid="uat-coverage-links">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2">Test case</th>
                  <th className="text-left px-3 py-2 w-44">Coverage type</th>
                </tr>
              </thead>
              <tbody>
                {coverage.map((link) => {
                  const testCase = allCases.find((c) => c.pmo_uattestcaseid === link._pmo_testcase_value);
                  return (
                    <tr key={link.pmo_uatcoveragelinkid} className="border-t border-border">
                      <td className="px-3 py-1.5">
                        <button
                          type="button"
                          className="text-primary hover:underline"
                          onClick={() => navigate(`/uat/test-cases/${link._pmo_testcase_value}`)}
                        >
                          {testCase ? `${testCase.pmo_name} · ${testCase.pmo_title}` : link._pmo_testcase_value}
                        </button>
                      </td>
                      <td className="px-3 py-1.5">
                        {UAT_COVERAGE_TYPE_LABELS[link.pmo_coveragetype ?? -1] ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* T032's last deferred mount: a requirement is where a specification document belongs. */}
      <UatEvidenceFor parent="Requirement" recordId={id} projectId={projectId} />

      <CoverageLinkDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        from="requirement"
        fixedId={id ?? ''}
        fixedLabel={`${requirement.pmo_name} · ${requirement.pmo_title}`}
        candidates={candidates}
        onLinked={() => void refetchCoverage()}
      />
    </div>
  );
}

export default RequirementDetailPage;
