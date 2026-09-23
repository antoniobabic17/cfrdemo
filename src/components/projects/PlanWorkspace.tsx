import { useState, useMemo } from 'react';
import {
  Plus, Trash2, Search, CheckCircle2, Loader2, FileText,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { DocumentLibrary } from './DocumentLibrary';
import { TaskDocumentsPanel } from './TaskDocumentsPanel';
import type { Project } from '../../models/project.model';
import { READ_ONLY_TOOLTIP } from '../../hooks/useProjectPermissions';
import { fmtDateOnly } from '../../lib/dateOnly';
import { CostLedgerSection } from './CostLedgerSection';
import { RESOURCE_METRIC_TYPE } from '../../lib/constants';

function fmtDate(v?: string) { return fmtDateOnly(v); }
function fmtNumber(v?: number, decimals = 0) { return v != null ? v.toFixed(decimals) : '—'; }

function ScoreRow({ label, rating, score }: { label: string; rating?: string; score?: number }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/60 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-3">
        {rating && <span className="text-sm text-foreground font-medium">{rating}</span>}
        {score != null && (
          <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{score}</span>
        )}
      </div>
    </div>
  );
}

interface PlanWorkspaceProps {
  projectId: string;
  projectName?: string;
  project: Project;
  members: Array<{
    msdyn_projectteamid: string;
    msdyn_name?: string;
    msdyn_effort?: number;
    msdyn_percentage?: number;
    msdyn_start?: string;
    msdyn_finish?: string;
    '_msdyn_bookableresourceid_value@OData.Community.Display.V1.FormattedValue'?: string;
    '_msdyn_resourcecategory_value@OData.Community.Display.V1.FormattedValue'?: string;
  }>;
  bookableResources: Array<{ bookableresourceid: string; name: string }>;
  assignedResourceIds: Set<string>;
  onAddMember: (resourceId: string) => Promise<void>;
  onRemoveMember: (teamMemberId: string) => Promise<void>;
  addMemberPending: boolean;
  canEdit: boolean;
  /** Tasks for this project. Powers the Task-docs rollup column on the
   *  Documents sub-tab -- each task-scoped upload is chip-labelled with
   *  its task subject via taskNamesById. Empty array is fine: the rollup
   *  column just renders "No task documents". */
  tasks?: Array<{ msdyn_projecttaskid: string; msdyn_subject?: string }>;
  /** True when this project has the New Resource Model enabled. Drives the
   *  second, separately-labeled Resources section. */
  useNewResourceModel?: boolean;
  /** All pmo_taskassignment-derived assignees for this project (all tasks).
   *  Summed per person for the New Resource Model section. */
  newModelAssignees?: Array<{ teamMemberId: string; name: string; taskId: string; contributedHours?: number }>;
  /** Standard monthly capacity hours (pmo.standard_capacity_hours, default 160). */
  capacityHours?: number;
  /** Resource Metric Type (RESOURCE_METRIC_TYPE). Financial projects show the
   *  Cost Ledger instead of the labor hours table. Defaults to Labor. */
  resourceMetricType?: number;
}

export function PlanWorkspace({
  projectId, projectName, project, members,
  bookableResources, assignedResourceIds,
  onAddMember, onRemoveMember, addMemberPending,
  canEdit,
  tasks = [],
  useNewResourceModel = false,
  newModelAssignees = [],
  capacityHours = 160,
  resourceMetricType = RESOURCE_METRIC_TYPE.Labor,
}: PlanWorkspaceProps) {
  const isFinancial = resourceMetricType === RESOURCE_METRIC_TYPE.Financial;
  // Precompute id -> subject so the Task-docs column can chip-label each row.
  const taskNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of tasks) {
      if (t.msdyn_projecttaskid && t.msdyn_subject) {
        map[t.msdyn_projecttaskid] = t.msdyn_subject;
      }
    }
    return map;
  }, [tasks]);
  const taskIdsForRollup = useMemo(
    () => tasks.map((t) => t.msdyn_projecttaskid).filter(Boolean),
    [tasks],
  );
  // New Resource Model: sum contributed hours per assignee across all tasks
  // on this project, plus how many tasks each person is on.
  const newModelRows = useMemo(() => {
    const byPerson = new Map<string, { name: string; hours: number; taskIds: Set<string> }>();
    for (const a of newModelAssignees) {
      if (!a.teamMemberId) continue;
      const b = byPerson.get(a.teamMemberId) ?? { name: a.name, hours: 0, taskIds: new Set<string>() };
      b.hours += a.contributedHours ?? 0;
      if (a.taskId) b.taskIds.add(a.taskId);
      byPerson.set(a.teamMemberId, b);
    }
    return Array.from(byPerson.entries())
      .map(([id, b]) => ({ id, name: b.name, hours: b.hours, taskCount: b.taskIds.size }))
      .sort((x, y) => y.hours - x.hours);
  }, [newModelAssignees]);
  // Documents is the sub-tab people actually open the Plan tab for, so it is the
  // landing view. Resources stays first in the TabsList (its order is unchanged).
  const [subTab, setSubTab] = useState('documents');
  const [addResourceOpen, setAddResourceOpen] = useState(false);
  const [resourceSearch, setResourceSearch] = useState('');
  const [selectedResourceId, setSelectedResourceId] = useState('');
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [removeMemberError, setRemoveMemberError] = useState<string | null>(null);

  const filteredResources = useMemo(() => {
    const q = resourceSearch.toLowerCase().trim();
    return bookableResources.filter(
      (r) => !assignedResourceIds.has(r.bookableresourceid) && (!q || r.name.toLowerCase().includes(q)),
    );
  }, [bookableResources, assignedResourceIds, resourceSearch]);

  async function handleAddMember() {
    if (!selectedResourceId) return;
    setResourceError(null);
    try {
      await onAddMember(selectedResourceId);
      setAddResourceOpen(false);
      setSelectedResourceId('');
      setResourceSearch('');
    } catch (err) {
      setResourceError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRemoveMember(teamMemberId: string) {
    setRemoveMemberError(null);
    setRemovingMemberId(teamMemberId);
    try {
      await onRemoveMember(teamMemberId);
    } catch (err) {
      setRemoveMemberError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemovingMemberId(null);
    }
  }

  return (
    <Tabs value={subTab} onValueChange={setSubTab}>
      <TabsList className="bg-muted/30 h-8 gap-0">
        <TabsTrigger value="documents" className="text-xs h-7 px-3">Documents</TabsTrigger>
        <TabsTrigger value="business-case" className="text-xs h-7 px-3">Business Case</TabsTrigger>
        <TabsTrigger value="resources" className="text-xs h-7 px-3">Resources</TabsTrigger>
      </TabsList>

      {/* Resources */}
      <TabsContent value="resources" className="mt-4 space-y-6">
        {/* Old Resource Model (P4W) — shown only when the project is NOT on the New Resource Model. */}
        {!useNewResourceModel && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            Old Resource Model (P4W)
          </p>
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-muted-foreground">
            {members.length} resource{members.length !== 1 ? 's' : ''} assigned
          </p>
          <Button
            size="sm"
            onClick={() => { setResourceSearch(''); setSelectedResourceId(''); setResourceError(null); setAddResourceOpen(true); }}
            disabled={addMemberPending || !canEdit}
            title={!canEdit ? READ_ONLY_TOOLTIP : undefined}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />Add Resource
          </Button>
        </div>

        {removeMemberError && (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-center justify-between gap-2">
            <span>{removeMemberError}</span>
            <button onClick={() => setRemoveMemberError(null)} className="shrink-0 hover:opacity-70">&times;</button>
          </div>
        )}

        {members.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm text-muted-foreground">No resources assigned.{canEdit && <> <button onClick={() => { setResourceSearch(''); setSelectedResourceId(''); setResourceError(null); setAddResourceOpen(true); }} className="text-primary hover:underline">+ Add Resource</button></>}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden max-w-5xl">
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_80px_72px_180px_32px] gap-x-4 px-4 py-2.5 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              <span>Name</span>
              <span>Role</span>
              <span className="text-right">Effort (h)</span>
              <span className="text-right">Alloc %</span>
              <span className="text-right">Dates</span>
              <span />
            </div>
            <div className="divide-y divide-border/60">
              {members.map((m) => {
                const isRemoving = removingMemberId === m.msdyn_projectteamid;
                return (
                  <div key={m.msdyn_projectteamid} className={cn('grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_80px_72px_180px_32px] gap-x-4 px-4 py-3.5 items-center hover:bg-muted/20 transition-colors', isRemoving && 'opacity-50')}>
                    <span className="text-sm font-medium text-foreground truncate">
                      {m['_msdyn_bookableresourceid_value@OData.Community.Display.V1.FormattedValue'] ?? m.msdyn_name ?? '—'}
                    </span>
                    <span className="text-sm text-muted-foreground truncate">
                      {m['_msdyn_resourcecategory_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}
                    </span>
                    <span className="text-sm text-muted-foreground text-right tabular-nums">
                      {fmtNumber(m.msdyn_effort, 1)}
                    </span>
                    <span className="text-sm text-muted-foreground text-right tabular-nums">
                      {m.msdyn_percentage != null ? `${m.msdyn_percentage.toFixed(0)}%` : '—'}
                    </span>
                    <span className="text-xs text-muted-foreground text-right whitespace-nowrap">
                      {m.msdyn_start ? fmtDate(m.msdyn_start) : '—'}
                      {m.msdyn_finish ? ` – ${fmtDate(m.msdyn_finish)}` : ''}
                    </span>
                    {canEdit && (
                      <button
                        onClick={() => handleRemoveMember(m.msdyn_projectteamid)}
                        disabled={isRemoving}
                        className="flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                        title="Remove resource"
                      >
                        {isRemoving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Add Resource dialog */}
        <Dialog open={addResourceOpen} onOpenChange={(o) => { if (!o) setAddResourceOpen(false); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add Resource</DialogTitle>
              <DialogDescription>Search for and add a bookable resource to this project.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={resourceSearch}
                  onChange={(e) => { setResourceSearch(e.target.value); setSelectedResourceId(''); }}
                  placeholder="Search by name..."
                  className="w-full h-9 rounded-md border border-input bg-background pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                />
              </div>
              <div className="max-h-60 overflow-y-auto rounded-md border border-border divide-y divide-border/60">
                {filteredResources.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-3 py-4 text-center">
                    {bookableResources.length === 0 ? 'Loading resources...' : 'No matching resources found.'}
                  </p>
                ) : filteredResources.map((r) => (
                  <button
                    key={r.bookableresourceid}
                    onClick={() => setSelectedResourceId(r.bookableresourceid)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors',
                      selectedResourceId === r.bookableresourceid
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'hover:bg-muted/40 text-foreground',
                    )}
                  >
                    {selectedResourceId === r.bookableresourceid && (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                    <span className={cn('truncate', selectedResourceId !== r.bookableresourceid && 'pl-[1.375rem]')}>{r.name}</span>
                  </button>
                ))}
              </div>
            </div>
            {resourceError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive max-h-20 overflow-y-auto break-words">
                {resourceError}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddResourceOpen(false)}>Cancel</Button>
              <Button disabled={!selectedResourceId || addMemberPending} onClick={handleAddMember}>
                {addMemberPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                {addMemberPending ? 'Adding...' : 'Add Resource'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
        )}{/* end Old Resource Model */}

        {/* New Resource Model — per-assignee contributed hours. Shown only when the project is ON the New Resource Model AND not a Financial project (Financial shows the Cost Ledger instead). */}
        {useNewResourceModel && !isFinancial && (
        <div className="border-t border-border/40 pt-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
            New Resource Model
          </p>
          <p className="text-xs text-muted-foreground mb-3">Based on per-task contributed hours.</p>
          {!useNewResourceModel ? (
            <p className="text-sm text-muted-foreground italic">
              Enable the New Resource Model in Financials → Resourcing to track hours by assignee.
            </p>
          ) : newModelRows.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No contributed hours recorded yet. Add hours via the Assignees section of any task.
            </p>
          ) : (
            <div className="rounded-xl border border-border bg-card overflow-hidden max-w-5xl">
              <div className="grid grid-cols-[minmax(0,2fr)_80px_80px_80px] gap-x-4 px-4 py-2.5 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                <span>Name</span>
                <span className="text-right">Hours</span>
                <span className="text-right">Capacity</span>
                <span className="text-right">Tasks</span>
              </div>
              <div className="divide-y divide-border/60">
                {newModelRows.map((r) => {
                  const pct = Math.min(Math.round((r.hours / capacityHours) * 100), 999);
                  const isOver = r.hours > capacityHours;
                  return (
                    <div key={r.id} className="grid grid-cols-[minmax(0,2fr)_80px_80px_80px] gap-x-4 px-4 py-3.5 items-center hover:bg-muted/20 transition-colors">
                      <span className="text-sm font-medium text-foreground truncate">{r.name}</span>
                      <span className={cn('text-sm text-right tabular-nums', isOver ? 'text-rose-600 font-semibold' : 'text-muted-foreground')}>
                        {r.hours}h
                      </span>
                      <span className={cn('text-sm text-right tabular-nums', isOver ? 'text-rose-600' : 'text-muted-foreground')}>
                        {pct}%
                      </span>
                      <span className="text-sm text-muted-foreground text-right tabular-nums">{r.taskCount}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        )}

        {/* Cost Ledger — Financial projects only. Replaces the labor hours table. */}
        {isFinancial && (
          <CostLedgerSection
            projectId={projectId}
            budget={project.proj_budget}
            currentActualCost={project.proj_actualcost}
            canEdit={canEdit}
          />
        )}
      </TabsContent>

      {/* Documents -- two-column: project docs on left, rolled-up task docs on right.
          Mirrors the Notes tab layout on the project details page. */}
      <TabsContent value="documents" className="mt-4 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Documents</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Project documents on the left; rolled-up task documents on the right.
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Project documents
            </h3>
            <DocumentLibrary
              recordType="Project"
              recordId={projectId}
              recordName={projectName ?? ''}
              projectId={projectId}
              readOnly={!canEdit}
            />
          </div>
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Task documents
            </h3>
            <TaskDocumentsPanel
              projectId={projectId}
              projectName={projectName ?? ''}
              tasks={tasks}
              taskIdsForRollup={taskIdsForRollup}
              taskNamesById={taskNamesById}
              canEdit={canEdit}
            />
          </div>
        </div>
      </TabsContent>

      {/* Business Case */}
      <TabsContent value="business-case" className="mt-4">
        <div className="grid grid-cols-12 gap-5">
          <div className="col-span-12 lg:col-span-7 space-y-5">
            {project.msdyn_businesscase ? (
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Business Case</h3>
                <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{project.msdyn_businesscase}</p>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
                <FileText className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm font-medium text-foreground">No business case entered</p>
                <p className="text-xs text-muted-foreground mt-1">Use the Edit Project button to add a business case.</p>
              </div>
            )}
            {project.msdyn_valuestatement && (
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Value Statement</h3>
                <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{project.msdyn_valuestatement}</p>
              </div>
            )}
          </div>
          <div className="col-span-12 lg:col-span-5 space-y-5">
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Strategic Scoring</h3>
              <div className="divide-y divide-border/60">
                <ScoreRow label="Strategic Alignment" rating={project['proj_strategicalignment@OData.Community.Display.V1.FormattedValue']} score={project.proj_strategicalignmentscore} />
                <ScoreRow label="Improve Employee Retention" rating={project['proj_improveemployeeretention@OData.Community.Display.V1.FormattedValue']} score={project.proj_improveemployeeretentionscore} />
                <ScoreRow label="Lower Cost" rating={project['proj_lowercost@OData.Community.Display.V1.FormattedValue']} score={project.proj_lowercostscore} />
                <ScoreRow label="Risk" rating={project['proj_risk@OData.Community.Display.V1.FormattedValue']} score={project.proj_riskscore} />
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Scoring Summary</h3>
              <div className="space-y-3">
                {project.proj_prioritizationscore != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Prioritization Score</span>
                    <span className="text-sm font-bold text-foreground">{fmtNumber(project.proj_prioritizationscore, 2)}</span>
                  </div>
                )}
                {project.proj_roi != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Return on Investment</span>
                    <span className={cn('text-sm font-bold', project.proj_roi >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
                      {project.proj_roi.toFixed(1)}%
                    </span>
                  </div>
                )}
                {project.proj_prioritizationscore == null && project.proj_roi == null && (
                  <p className="text-sm text-muted-foreground">No scoring data available.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}
