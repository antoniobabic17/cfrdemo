/**
 * RequirementListPage — the epic → story hierarchy, and the coverage view over it.
 *
 * **Two levels, displayed as two levels.** Stories are indented under their epic and a story
 * whose epic is filtered out is promoted rather than hidden — the same rule the platform applies
 * when an epic is deleted (`pmo_parent` is RemoveLink, so stories are promoted, not cascaded). A
 * requirement that disappeared from this list because of its parent would be untested work
 * nobody could see.
 *
 * **The coverage matrix lives here too**, over the same rows, so the answer to "what is covered"
 * and the answer to "what requirements exist" cannot disagree. T050's matrix is one component
 * fed from `uatCoverage.ts`; this page does no coverage arithmetic of its own.
 *
 * **The ITPR is not here.** It belongs on the project's UAT settings as a single editable
 * reference field, and T047 says so explicitly: not its own list, not a lookup to a record type,
 * no validation against any external system, because the IT staff who own those numbers have no
 * access to this application. A test asserts this page never mentions it.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ListChecks, Plus, Loader2, Network } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { toast } from '../../../hooks/useToast';
import { useActiveProjects } from '../../../hooks/useProjects';
import { useUatRequirements, useCreateUatRequirement } from '../../../hooks/useUatRequirements';
import { useAllUatTestCases } from '../../../hooks/useUatTestCases';
import { CoverageMatrix } from '../components/CoverageMatrix';
import { requirementTree } from '../lib/uatCoverage';
import {
  UAT_REQUIREMENT_TYPE, UAT_REQUIREMENT_TYPE_LABELS,
  UAT_REQUIREMENT_STATUS_LABELS,
} from '../../../lib/uatOptionSets';
import { readProjectValue } from '../../../lib/projectLookupRef';
import { useUatCoverageForProject } from '../hooks/useUatCoverage';

type View = 'list' | 'coverage';

export function RequirementListPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const projectId = params.get('projectId') ?? '';
  const [view, setView] = useState<View>('list');
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<number>(UAT_REQUIREMENT_TYPE.Story);

  const { data: requirements = [], isPending, isError, refetch } = useUatRequirements(projectId || undefined);
  const { data: projects = [] } = useActiveProjects();
  const createRequirement = useCreateUatRequirement(projectId);
  const { links, cases } = useUatCoverageForProject(projectId || undefined);
  const { data: allCases = [] } = useAllUatTestCases();

  const tree = useMemo(
    () => requirementTree(requirements.map((r) => ({
      requirementId: r.pmo_uatrequirementid,
      parentId: r._pmo_parent_value,
      row: r,
    }))),
    [requirements],
  );

  const matrixRequirements = useMemo(
    () => requirements.map((r) => ({
      requirementId: r.pmo_uatrequirementid,
      name: r.pmo_name,
      title: r.pmo_title,
      parentId: r._pmo_parent_value,
    })),
    [requirements],
  );

  const projectCases = useMemo(
    () => cases.length > 0
      ? cases
      : allCases
        .filter((c) => readProjectValue(c) === projectId)
        .map((c) => ({ testCaseId: c.pmo_uattestcaseid, executionStatus: c.pmo_executionstatus })),
    [cases, allCases, projectId],
  );

  async function handleCreate() {
    if (!newTitle.trim()) return;
    try {
      await createRequirement.mutateAsync({ pmo_title: newTitle.trim(), pmo_type: newType });
      setNewTitle('');
      toast.success('Requirement added.');
    } catch {
      // useAppMutation toasted and logged it.
    }
  }

  if (!projectId) {
    return (
      <div className="p-6 space-y-4 max-w-xl">
        <h1 className="text-xl font-semibold">UAT requirements</h1>
        <p className="text-sm text-muted-foreground">
          Requirements belong to a project. Choose one to see its backlog and its coverage.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="req-project">Project</Label>
          <select
            id="req-project"
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
          <ListChecks className="h-5 w-5" aria-hidden /> Requirements
        </h1>
        <div className="flex gap-1.5">
          <Button size="sm" variant={view === 'list' ? 'default' : 'outline'} onClick={() => setView('list')}>
            Backlog ({requirements.length})
          </Button>
          <Button size="sm" variant={view === 'coverage' ? 'default' : 'outline'} onClick={() => setView('coverage')}>
            <Network className="mr-1.5 h-4 w-4" aria-hidden /> Coverage
          </Button>
        </div>
      </div>

      <div className="flex items-end gap-2 max-w-2xl">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="req-title">New requirement</Label>
          <Input
            id="req-title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="What must be true for this to be accepted?"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="req-type">Type</Label>
          <select
            id="req-type"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={newType}
            onChange={(e) => setNewType(Number(e.target.value))}
          >
            {Object.values(UAT_REQUIREMENT_TYPE).map((value) => (
              <option key={value} value={value}>{UAT_REQUIREMENT_TYPE_LABELS[value]}</option>
            ))}
          </select>
        </div>
        <Button onClick={() => void handleCreate()} disabled={!newTitle.trim() || createRequirement.isPending}>
          {createRequirement.isPending
            ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
            : <Plus className="mr-1.5 h-4 w-4" aria-hidden />}
          Add
        </Button>
      </div>

      {isPending && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading requirements…
        </p>
      )}
      {isError && (
        <div className="space-y-2" role="alert">
          <p className="text-sm text-destructive">
            The requirements could not be loaded. They still exist — this is a read failure.
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>Try again</Button>
        </div>
      )}

      {!isPending && !isError && requirements.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No requirements yet. Add the first one above — coverage is measured against these.
        </p>
      )}

      {view === 'coverage' && requirements.length > 0 && (
        <CoverageMatrix
          requirements={matrixRequirements}
          links={links}
          cases={projectCases}
          onRequirementClick={(id) => navigate(`/uat/requirements/${id}`)}
        />
      )}

      {view === 'list' && requirements.length > 0 && (
        <div className="rounded-md border border-border overflow-x-auto">
          <table className="w-full text-sm" data-testid="uat-requirement-rows">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 w-28">Ref</th>
                <th className="text-left px-3 py-2">Title</th>
                <th className="text-left px-3 py-2 w-32">Type</th>
                <th className="text-left px-3 py-2 w-32">Status</th>
              </tr>
            </thead>
            <tbody>
              {tree.flatMap((node) => [
                { node: node.requirement, child: false },
                ...node.children.map((c) => ({ node: c, child: true })),
              ]).map(({ node, child }) => (
                <tr
                  key={node.requirementId}
                  className="border-t border-border cursor-pointer hover:bg-muted/40"
                  onClick={() => navigate(`/uat/requirements/${node.requirementId}`)}
                >
                  <td className="px-3 py-1.5 tabular-nums">{node.row.pmo_name}</td>
                  <td className={`px-3 py-1.5 ${child ? 'pl-8 text-muted-foreground' : ''}`}>
                    {node.row.pmo_title}
                  </td>
                  <td className="px-3 py-1.5">
                    {UAT_REQUIREMENT_TYPE_LABELS[node.row.pmo_type ?? -1] ?? '—'}
                  </td>
                  <td className="px-3 py-1.5">
                    {UAT_REQUIREMENT_STATUS_LABELS[node.row.pmo_status ?? -1] ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default RequirementListPage;
