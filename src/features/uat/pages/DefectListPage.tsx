/**
 * DefectListPage — every defect on a project, and what each one is attached to.
 *
 * **Reachable two ways, one component.** The sidebar route shows a project's defects once a
 * project is chosen; the project's UAT tab will show the same list for its own project. Both
 * render this page, so a filter or a column added here appears on both by construction — the
 * like-surface rule the route table declares.
 *
 * **A row's links are shown, not implied.** Whether a defect has a case, a run and a
 * requirement behind it is the difference between a defect somebody can act on and a note. The
 * list says which of the three are set, and the detail panel links to them.
 *
 * The detail panel holds the lifecycle control (T043) and the defect's evidence. Evidence is
 * mounted here because a defect is where a screenshot of the failure belongs, and this is the
 * defect surface T032 had none of.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Bug, Plus, Loader2, ExternalLink } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Label } from '../../../components/ui/label';
import { useActiveProjects } from '../../../hooks/useProjects';
import { useUatDefects } from '../../../hooks/useUatDefects';
import { DefectCreateDialog } from '../components/DefectCreateDialog';
import { DefectStatusControl } from '../components/DefectStatusControl';
import { UatEvidenceFor } from '../components/UatAttachmentMounts';
import {
  UAT_DEFECT_STATUS,
  UAT_DEFECT_STATUS_LABELS,
  UAT_DEFECT_SEVERITY_LABELS,
  UAT_PRIORITY_LABELS,
} from '../../../lib/uatOptionSets';
import type { UatDefect } from '../../../models/uatDefect.model';

/** The statuses that mean "no longer being worked". Used by the open/all filter. */
const CLOSED_STATUSES: readonly number[] = [
  UAT_DEFECT_STATUS.Closed,
  UAT_DEFECT_STATUS.Cancelled,
  UAT_DEFECT_STATUS.Deferred,
];

export interface DefectListPageProps {
  /** Supplied when rendered inside a project's UAT tab; read from the URL otherwise. */
  projectId?: string;
}

export function DefectListPage({ projectId: fixedProjectId }: DefectListPageProps = {}) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const projectId = fixedProjectId ?? params.get('projectId') ?? '';

  const [showClosed, setShowClosed] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: defects = [], isPending, isError, refetch } = useUatDefects(projectId || undefined);
  const { data: projects = [] } = useActiveProjects();

  const shown = useMemo(
    () => (showClosed ? defects : defects.filter((d) => !CLOSED_STATUSES.includes(d.pmo_status ?? -1))),
    [defects, showClosed],
  );
  const selected = shown.find((d) => d.pmo_uatdefectid === selectedId)
    ?? defects.find((d) => d.pmo_uatdefectid === selectedId)
    ?? null;

  // The sidebar route arrives with no project. Asking is better than an error the operator
  // cannot act on — the same reasoning as the import wizard's picker.
  if (!projectId) {
    return (
      <div className="p-6 space-y-4 max-w-xl">
        <h1 className="text-xl font-semibold">UAT defects</h1>
        <p className="text-sm text-muted-foreground">
          Defects belong to a project. Choose one to see its defects.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="defect-project">Project</Label>
          <select
            id="defect-project"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            defaultValue=""
            onChange={(e) => { if (e.target.value) setParams({ projectId: e.target.value }); }}
          >
            <option value="" disabled>Choose a project…</option>
            {projects.map((project) => (
              <option key={project.msdyn_projectid} value={project.msdyn_projectid}>
                {project.msdyn_subject}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Bug className="h-5 w-5" aria-hidden /> Defects
        </h1>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={showClosed ? 'default' : 'outline'}
            onClick={() => setShowClosed((v) => !v)}
          >
            {showClosed ? `All (${defects.length})` : `Open (${shown.length})`}
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Raise a defect
          </Button>
        </div>
      </div>

      {isPending && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading defects…
        </p>
      )}
      {isError && (
        <div className="space-y-2" role="alert">
          {/* Never "no defects": a failed read claiming an empty list tells the tester their
              defects are gone. */}
          <p className="text-sm text-destructive">
            The defects could not be loaded. They still exist — this is a read failure.
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>Try again</Button>
        </div>
      )}
      {!isPending && !isError && shown.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {defects.length === 0
            ? 'No defects have been raised on this project.'
            : 'No open defects. Switch to All to see the closed ones.'}
        </p>
      )}

      {shown.length > 0 && (
        <div className="rounded-md border border-border overflow-x-auto">
          <table className="w-full text-sm" data-testid="uat-defect-rows">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 w-28">Defect</th>
                <th className="text-left px-3 py-2">Summary</th>
                <th className="text-left px-3 py-2 w-40">Status</th>
                <th className="text-left px-3 py-2 w-28">Severity</th>
                <th className="text-left px-3 py-2 w-28">Priority</th>
                <th className="text-left px-3 py-2 w-36">Linked to</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((defect) => (
                <tr
                  key={defect.pmo_uatdefectid}
                  onClick={() => setSelectedId(defect.pmo_uatdefectid)}
                  className={`border-t border-border cursor-pointer hover:bg-muted/40 ${
                    selectedId === defect.pmo_uatdefectid ? 'bg-muted/60' : ''
                  }`}
                >
                  <td className="px-3 py-1.5 tabular-nums">{defect.pmo_name}</td>
                  <td className="px-3 py-1.5">{defect.pmo_summary}</td>
                  <td className="px-3 py-1.5">
                    {UAT_DEFECT_STATUS_LABELS[defect.pmo_status ?? -1] ?? '—'}
                  </td>
                  <td className="px-3 py-1.5">
                    {UAT_DEFECT_SEVERITY_LABELS[defect.pmo_severity ?? -1] ?? '—'}
                  </td>
                  <td className="px-3 py-1.5">
                    {UAT_PRIORITY_LABELS[defect.pmo_priority ?? -1] ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">
                    {/* Which of the three links exist. A defect with none is a note; the list
                        should not make the two look alike. */}
                    {linkSummary(defect)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <section className="rounded-md border border-border p-4 space-y-4" aria-label="Defect detail">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">{selected.pmo_name} · {selected.pmo_summary}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Reported {selected.pmo_reportedon?.slice(0, 10) ?? '—'} · {linkSummary(selected)}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setSelectedId(null)}>Close</Button>
          </div>

          {selected.pmo_details && (
            <p className="text-sm whitespace-pre-wrap">{selected.pmo_details}</p>
          )}

          {selected._pmo_testcase_value && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/uat/test-cases/${selected._pmo_testcase_value}`)}
            >
              <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden /> Open the test case
            </Button>
          )}

          <DefectStatusControl defect={selected} projectId={projectId} />

          <UatEvidenceFor
            parent="Defect"
            recordId={selected.pmo_uatdefectid}
            projectId={projectId}
          />
        </section>
      )}

      <DefectCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={projectId}
        onCreated={(id) => setSelectedId(id)}
      />
    </div>
  );
}

/** "Case · Run · Requirement", naming only the links that are set. */
function linkSummary(defect: UatDefect): string {
  const parts: string[] = [];
  if (defect._pmo_testcase_value) parts.push('Case');
  if (defect._pmo_testrun_value) parts.push('Run');
  if (defect._pmo_requirement_value) parts.push('Requirement');
  return parts.length > 0 ? parts.join(' · ') : 'nothing';
}

export default DefectListPage;
