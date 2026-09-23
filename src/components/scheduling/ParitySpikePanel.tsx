/**
 * Parity Spike Validation Panel — DEV ONLY
 *
 * Validates write paths for task fields and schema of new scheduling entities.
 * Spikes S1–S8 from the parity plan. Run against DEV; never deploy to PROD.
 *
 * Each spike is independent. Run selectively. Results are informational only —
 * they gate whether editing for a given field is safe to enable in-app.
 */
import { useState } from 'react';
import { CheckCircle, XCircle, Loader2, ChevronDown, ChevronRight, FlaskConical, AlertCircle } from 'lucide-react';
import { createOperationSet, executeOperationSet } from '../../lib/schedulingClient';
import { executeAction, list } from '../../lib/dataverseClient';
import { ENTITY_SETS } from '../../lib/constants';
import type { ProjectTask } from '../../models/projectTask.model';

interface SpikeResult {
  success: boolean;
  message: string;
  detail?: unknown;
}

interface Props {
  projectId: string;
  tasks: ProjectTask[];
}

// Helper: pick the first writable leaf task (non-summary, non-optimistic, active, not done)
function pickTask(tasks: ProjectTask[]): ProjectTask | null {
  return tasks.find((t) => {
    if (t.msdyn_summary || t.msdyn_projecttaskid.startsWith('optimistic-')) return false;
    if (t.statecode !== 0) return false;
    const raw = t.msdyn_progress ?? 0;
    const pct = raw > 0 && raw <= 1 ? raw * 100 : raw;
    return pct < 100; // skip completed tasks — PSS rejects writes to completed tasks
  }) ?? null;
}

// Helper: pick a task that already has a parent (for S7 reparent test)
function pickTaskWithParent(tasks: ProjectTask[]): ProjectTask | null {
  return tasks.find((t) =>
    !t.msdyn_summary &&
    !t.msdyn_projecttaskid.startsWith('optimistic-') &&
    t.statecode === 0 &&
    !!t['_msdyn_parenttask_value'],
  ) ?? null;
}

async function pssUpdateTaskField(
  projectId: string,
  taskId: string,
  field: string,
  value: unknown,
): Promise<void> {
  const opSetId = await createOperationSet(projectId, `Parity spike: ${field}`);
  const entity: Record<string, unknown> = {
    '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projecttask',
    msdyn_projecttaskid: taskId,
    [field]: value,
  };
  await executeAction<{ Entity: object; OperationSetId: string }, { OperationSetId: string }>(
    'msdyn_projects',
    'msdyn_PssUpdateV1',
    { Entity: entity, OperationSetId: opSetId },
  );
  await executeOperationSet(opSetId);
}

async function waitAndReadTask(taskId: string, delayMs = 5000): Promise<ProjectTask | null> {
  await new Promise((r) => setTimeout(r, delayMs));
  const results = await list<ProjectTask>(ENTITY_SETS.projectTask, {
    $select: ['msdyn_projecttaskid', 'msdyn_subject', 'msdyn_description', 'msdyn_priority', 'msdyn_effort', 'msdyn_effortcompleted', 'msdyn_progress'],
    $filter: `msdyn_projecttaskid eq '${taskId}'`,
  });
  return results[0] ?? null;
}

async function queryEntityMetadata(entitySet: string, filter?: string): Promise<unknown> {
  // Light OData query — fetch top 5 to see if entity is accessible and return schema hints
  return list<Record<string, unknown>>(entitySet as never, (filter ? { $top: 5, $filter: filter } : { $top: 5 }) as never);
}

function SpikeRow({ label, note, onRun }: { label: string; note: string; onRun: () => Promise<SpikeResult> }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SpikeResult | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const r = await onRun();
      setResult(r);
    } catch (err) {
      setResult({ success: false, message: 'Unexpected error', detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="border border-border rounded-md p-2.5 space-y-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">{label}</p>
          <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">{note}</p>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="shrink-0 text-[11px] px-2.5 py-1 rounded border border-border bg-muted/30 hover:bg-muted text-foreground disabled:opacity-50 transition-colors flex items-center gap-1"
        >
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Run'}
        </button>
      </div>
      {result && (
        <div className={`flex items-start gap-1.5 text-[11px] rounded p-1.5 ${result.success ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/30'}`}>
          {result.success
            ? <CheckCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            : <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
          <div className="space-y-0.5">
            <p className="font-semibold">{result.message}</p>
            {result.detail !== undefined && (
              <pre className="text-[10px] whitespace-pre-wrap break-all font-mono opacity-80">{JSON.stringify(result.detail, null, 2)}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ParitySpikePanel({ projectId, tasks }: Props) {
  const [expanded, setExpanded] = useState(false);
  const testTask = pickTask(tasks);
  const taskWithParent = pickTaskWithParent(tasks);

  if (!testTask) return null;

  const taskId = testTask.msdyn_projecttaskid;
  const taskName = testTask.msdyn_subject.slice(0, 30);

  return (
    <div className="rounded-lg border border-violet-400/40 bg-violet-50/20 dark:bg-violet-950/10 p-3 text-xs">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-violet-700 dark:text-violet-400 font-semibold w-full"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <FlaskConical className="h-3.5 w-3.5" />
        DEV: Parity Spike Validation (S1–S8)
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/30 rounded p-2">
            <AlertCircle className="h-3 w-3 shrink-0" />
            Test task: <span className="font-mono font-semibold">{taskName}…</span> ({taskId.slice(0, 8)}…)
            — results gate in-app editing for each field.
          </div>

          <SpikeRow
            label="S1 — Description write via PssUpdateV1"
            note="Sends msdyn_description in PssUpdateV1. Reads back after 5s to confirm persistence."
            onRun={async () => {
              const marker = `spike-s1-${Date.now()}`;
              await pssUpdateTaskField(projectId, taskId, 'msdyn_description', marker);
              const t = await waitAndReadTask(taskId, 6000);
              if (!t) return { success: false, message: 'Task not found after wait' };
              if (t.msdyn_description?.includes('spike-s1')) {
                return { success: true, message: 'PASS — description persisted via PSS', detail: t.msdyn_description };
              }
              return { success: false, message: 'FAIL — description not updated after 6s', detail: t.msdyn_description };
            }}
          />

          <SpikeRow
            label="S2 — Priority write via PssUpdateV1"
            note="Sends msdyn_priority: 3 (Critical) in PssUpdateV1. Reads back to confirm."
            onRun={async () => {
              const original = testTask.msdyn_priority;
              const newPriority = original === 3 ? 0 : 3;
              await pssUpdateTaskField(projectId, taskId, 'msdyn_priority', newPriority);
              const t = await waitAndReadTask(taskId, 6000);
              if (!t) return { success: false, message: 'Task not found after wait' };
              if (t.msdyn_priority === newPriority) {
                // Restore original
                if (original !== undefined) {
                  await pssUpdateTaskField(projectId, taskId, 'msdyn_priority', original).catch(() => {/* best effort restore */});
                }
                return { success: true, message: `PASS — priority updated to ${newPriority} via PSS` };
              }
              return { success: false, message: `FAIL — priority not updated. Got: ${t.msdyn_priority}`, detail: { expected: newPriority, got: t.msdyn_priority } };
            }}
          />

          <SpikeRow
            label="S3 — Intermediate effortCompleted via PssUpdateV1"
            note="Sets effortCompleted to 4h on a task to target ~50% progress. Verifies intermediate value persists (not overridden by engine)."
            onRun={async () => {
              const effort = testTask.msdyn_effort ?? 8;
              const targetCompleted = Math.round(effort / 2);
              await pssUpdateTaskField(projectId, taskId, 'msdyn_effortcompleted', targetCompleted);
              const t = await waitAndReadTask(taskId, 8000);
              if (!t) return { success: false, message: 'Task not found after wait' };
              const delta = Math.abs((t.msdyn_effortcompleted ?? 0) - targetCompleted);
              if (delta <= 0.5) {
                const rawPct = t.msdyn_progress ?? 0;
                const displayPct = rawPct > 0 && rawPct <= 1 ? Math.round(rawPct * 100) : Math.round(rawPct);
                return { success: true, message: `PASS — effortCompleted=${t.msdyn_effortcompleted}h, progress=${displayPct}% (raw Dataverse value: ${rawPct})` };
              }
              return {
                success: false,
                message: `FAIL — intermediate value not preserved after 8s`,
                detail: { expected: targetCompleted, got: t.msdyn_effortcompleted, progress: t.msdyn_progress },
              };
            }}
          />

          <SpikeRow
            label="S4 — Effort (msdyn_effort) write via PssUpdateV1"
            note="Updates msdyn_effort on the task entity. Verifies value persists (engine may recalculate from resource assignments)."
            onRun={async () => {
              const original = testTask.msdyn_effort ?? 8;
              const newEffort = original === 16 ? 12 : 16;
              await pssUpdateTaskField(projectId, taskId, 'msdyn_effort', newEffort);
              const t = await waitAndReadTask(taskId, 8000);
              if (!t) return { success: false, message: 'Task not found after wait' };
              if (Math.abs((t.msdyn_effort ?? 0) - newEffort) <= 0.5) {
                await pssUpdateTaskField(projectId, taskId, 'msdyn_effort', original).catch(() => {/* best effort restore */});
                return { success: true, message: `PASS — effort updated to ${newEffort}h via PSS` };
              }
              return { success: false, message: `FAIL — effort not updated after 8s. Got: ${t.msdyn_effort}`, detail: { expected: newEffort, got: t.msdyn_effort } };
            }}
          />

          <SpikeRow
            label="S5 — Label entity schema discovery"
            note="Queries msdyn_projectlabels (top 5, no project filter — labels are plan-scoped, not project-scoped). Any label records in the environment will reveal the schema."
            onRun={async () => {
              try {
                const rows = await queryEntityMetadata('msdyn_projectlabels');
                const arr = rows as unknown[];
                if (arr.length === 0) {
                  return { success: true, message: 'Entity accessible but no label records in environment — apply a label to any project in Planner first', detail: 'Empty result set — schema cannot be determined until records exist' };
                }
                return { success: true, message: `PASS — found ${arr.length} label record(s). Schema keys:`, detail: Object.keys(arr[0] as object) };
              } catch (err) {
                return { success: false, message: 'FAIL — entity inaccessible', detail: err instanceof Error ? err.message : String(err) };
              }
            }}
          />

          <SpikeRow
            label="S6 — Checklist entity schema discovery"
            note="Queries msdyn_projectchecklists (top 5, no project filter — checklists are task-scoped, not project-scoped). Any checklist records will reveal the schema."
            onRun={async () => {
              try {
                const rows = await queryEntityMetadata('msdyn_projectchecklists');
                const arr = rows as unknown[];
                if (arr.length === 0) {
                  return { success: true, message: 'Entity accessible but no checklist records in environment — add a checklist item to any task in Planner first', detail: 'Empty result set — schema cannot be determined until records exist' };
                }
                return { success: true, message: `PASS — found ${arr.length} checklist item(s). Schema keys:`, detail: Object.keys(arr[0] as object) };
              } catch (err) {
                return { success: false, message: 'FAIL — entity inaccessible', detail: err instanceof Error ? err.message : String(err) };
              }
            }}
          />

          <SpikeRow
            label="S6c — Checklist nav property (no $filter, client-side match)"
            note="$filter is not supported on RelationshipDefinitions. Queries top-500 without filter and matches msdyn_projectchecklist client-side. Will find the exact ReferencingNavigationPropertyName for @odata.bind."
            onRun={async () => {
              // Attempt 1: $select + $top (most efficient)
              let rows: Record<string, unknown>[] = [];
              let queryError = '';
              for (const params of [
                { $select: ['SchemaName', 'ReferencingEntity', 'ReferencedEntity', 'ReferencingNavigationPropertyName'], $top: 500 },
                { $top: 100 },
                {},
              ]) {
                try {
                  rows = await list<Record<string, unknown>>('RelationshipDefinitions' as never, params as never);
                  break;
                } catch (e) {
                  queryError = e instanceof Error ? e.message : String(e);
                }
              }

              if (rows.length === 0) {
                return { success: false, message: 'Could not query RelationshipDefinitions with any parameters', detail: queryError };
              }

              // Filter client-side for msdyn_projectchecklist
              const checklistRels = rows.filter((r) =>
                String(r.ReferencingEntity ?? r.referencingentity ?? '').includes('projectchecklist') ||
                String(r.ReferencedEntity ?? r.referencedentity ?? '').includes('projectchecklist')
              );

              if (checklistRels.length === 0) {
                return {
                  success: true,
                  message: `Got ${rows.length} relationships total, none matched msdyn_projectchecklist. Sample keys:`,
                  detail: Object.keys(rows[0] ?? {}),
                };
              }

              // Find the specific checklist→task relationship
              const taskRel = checklistRels.find((r) =>
                String(r.ReferencedEntity ?? r.referencedentity ?? '').includes('projecttask'),
              );
              return {
                success: true,
                message: `FOUND — raw relationship object for checklist→task (ALL keys):`,
                detail: taskRel ?? checklistRels,
              };
            }}
          />

          <SpikeRow
            label="S5b — Task-to-Label junction schema discovery"
            note="Queries msdyn_projecttasktolabels (top 5). Prerequisite: a label applied to a task in Planner. Reveals the task and label FK field names needed to implement label assignment."
            onRun={async () => {
              try {
                const rows = await queryEntityMetadata('msdyn_projecttasktolabels');
                const arr = rows as unknown[];
                if (arr.length === 0) {
                  return { success: true, message: 'Entity accessible but no task-to-label records — apply a label to a task in Planner first', detail: 'Empty result set' };
                }
                return { success: true, message: `PASS — found ${arr.length} task-label record(s). Schema keys:`, detail: Object.keys(arr[0] as object) };
              } catch (err) {
                return { success: false, message: 'FAIL — entity inaccessible', detail: err instanceof Error ? err.message : String(err) };
              }
            }}
          />

          <SpikeRow
            label="S7 — Reparent task via PssUpdateV1"
            note={
              taskWithParent
                ? `Re-binds task "${taskWithParent.msdyn_subject.slice(0, 25)}…" to its existing parent (no-op write — tests field acceptance without changing WBS).`
                : 'No task with an existing parent found. Create a WBS child task in Planner first, then re-run.'
            }
            onRun={async () => {
              if (!taskWithParent) {
                return { success: false, message: 'SKIP — no task with a parent found. Create a child task in Planner to enable this test.' };
              }
              const parentId = taskWithParent['_msdyn_parenttask_value']!;
              const opSetId = await createOperationSet(projectId, 'Spike S7: reparent field test');
              const entity: Record<string, unknown> = {
                '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projecttask',
                msdyn_projecttaskid: taskWithParent.msdyn_projecttaskid,
                // Re-bind to the SAME existing parent — no-op WBS change, tests field acceptance
                'msdyn_parenttask@odata.bind': `/msdyn_projecttasks(${parentId})`,
              };
              try {
                await executeAction<{ Entity: object; OperationSetId: string }, { OperationSetId: string }>(
                  'msdyn_projects', 'msdyn_PssUpdateV1',
                  { Entity: entity, OperationSetId: opSetId },
                );
                await executeOperationSet(opSetId);
                return { success: true, message: 'PASS — parenttask@odata.bind accepted by PSS. In-app reparenting is supported.' };
              } catch (err) {
                return {
                  success: false,
                  message: 'FAIL — parenttask binding rejected or PSS error',
                  detail: err instanceof Error ? err.message : String(err),
                };
              }
            }}
          />

          <SpikeRow
            label="S8 — Sprint entity schema discovery"
            note="Queries msdyn_projectsprints filtered to this project. Prerequisite: at least one sprint created in Planner for this project's plan."
            onRun={async () => {
              try {
                const rows = await queryEntityMetadata('msdyn_projectsprints', `_msdyn_project_value eq '${projectId}'`);
                const arr = rows as unknown[];
                if (arr.length === 0) {
                  return { success: true, message: 'Entity accessible but no sprint records for this project — create a sprint in Planner first', detail: 'Empty result set' };
                }
                return { success: true, message: `PASS — found ${arr.length} sprint(s). Schema keys:`, detail: Object.keys(arr[0] as object) };
              } catch (err) {
                return { success: false, message: 'FAIL — entity inaccessible', detail: err instanceof Error ? err.message : String(err) };
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
