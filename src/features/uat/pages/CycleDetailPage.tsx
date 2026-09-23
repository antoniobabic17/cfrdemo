/**
 * CycleDetailPage — one project's cycles, their dates, and the pace of each.
 *
 * **Planned and actual are four separate dates, not two with a meaning.** A cycle that started
 * late is a fact worth keeping: overwriting the planned date with the real one destroys the only
 * evidence that the plan moved, and a pace report built on a rewritten plan always says "on
 * track".
 *
 * **Status moves Planned → Active → Complete, and the dates are stamped by the move**, for the
 * same reason the defect lifecycle stamps its own dates: a date a person types can disagree with
 * the status it belongs to.
 *
 * **The chart is the shared component**, over rows this page already read — so the pace shown
 * here and the pace in the portfolio rollup are computed by the same function and cannot
 * disagree.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CalendarRange, Plus, Loader2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { toast } from '../../../hooks/useToast';
import {
  useUatCycles, useCreateUatCycle, useUpdateUatCycle,
} from '../../../hooks/useUatTestRuns';
import { useUatTestCases } from '../../../hooks/useUatTestCases';
import { UatPaceChart } from '../components/UatPaceChart';
import { UatEvidenceFor } from '../components/UatAttachmentMounts';
import { UAT_CYCLE_STATUS, UAT_CYCLE_STATUS_LABELS } from '../../../lib/uatOptionSets';
import type { UatCycleUpdate } from '../../../models/uatTestRun.model';

/** Which actual date a status transition stamps. Declared as data so a test can read it. */
export const CYCLE_STATUS_DATE_FIELD: Readonly<Record<number, keyof UatCycleUpdate>> = {
  [UAT_CYCLE_STATUS.Active]: 'pmo_actualstart',
  [UAT_CYCLE_STATUS.Complete]: 'pmo_actualend',
};

/** Today, as the date-only string the pace calculation takes. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CycleDetailPage() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [newName, setNewName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: cycles = [], isPending, isError, refetch } = useUatCycles(projectId || undefined);
  const { data: testCases = [] } = useUatTestCases(projectId || undefined);
  const createCycle = useCreateUatCycle(projectId);
  const updateCycle = useUpdateUatCycle(projectId);

  const selected = cycles.find((c) => c.pmo_uatcycleid === selectedId) ?? cycles[0] ?? null;

  /** The cases assigned to the selected cycle — what its pace is measured over. */
  const cycleCases = useMemo(
    () => testCases
      .filter((c) => c._pmo_cycle_value === selected?.pmo_uatcycleid)
      .map((c) => ({ testCaseId: c.pmo_uattestcaseid, executionStatus: c.pmo_executionstatus })),
    [testCases, selected],
  );

  async function handleCreate() {
    if (!newName.trim()) return;
    try {
      await createCycle.mutateAsync({
        pmo_name: newName.trim(),
        pmo_status: UAT_CYCLE_STATUS.Planned,
        pmo_sequence: cycles.length + 1,
      });
      setNewName('');
      toast.success('Cycle added.');
    } catch { /* useAppMutation reported it */ }
  }

  async function handleField(id: string, payload: UatCycleUpdate) {
    try {
      await updateCycle.mutateAsync({ id, payload });
    } catch { /* useAppMutation reported it */ }
  }

  async function handleStatus(id: string, status: number, current: number | null) {
    const payload: UatCycleUpdate = { pmo_status: status };
    const dateField = CYCLE_STATUS_DATE_FIELD[status];
    // Only on a real transition: re-saving an Active cycle must not move its actual start.
    if (dateField && status !== current) {
      (payload as Record<string, unknown>)[dateField] = todayIso();
    }
    await handleField(id, payload);
  }

  // No project picker here: the route is parameterised on the project, so a cycles page
  // without one cannot be navigated to. An empty id means a malformed URL, and saying so beats
  // rendering a picker that duplicates the project list two other pages already offer.
  if (!projectId) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive" role="alert">
          This link is missing its project. Open cycles from a project's UAT tab.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <CalendarRange className="h-5 w-5" aria-hidden /> Cycles
        </h1>
        <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${projectId}?tab=uat`)}>
          Back to the project
        </Button>
      </div>

      <div className="flex items-end gap-2 max-w-xl">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="cycle-name">New cycle</Label>
          <Input
            id="cycle-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Sprint 9 UAT"
          />
        </div>
        <Button onClick={() => void handleCreate()} disabled={!newName.trim() || createCycle.isPending}>
          {createCycle.isPending
            ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
            : <Plus className="mr-1.5 h-4 w-4" aria-hidden />}
          Add
        </Button>
      </div>

      {isPending && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading cycles…
        </p>
      )}
      {isError && (
        <div className="space-y-2" role="alert">
          <p className="text-sm text-destructive">
            The cycles could not be loaded. They still exist — this is a read failure.
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>Try again</Button>
        </div>
      )}
      {!isPending && !isError && cycles.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No cycles yet. A cycle is a dated window of testing — pace is measured against it.
        </p>
      )}

      {cycles.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="uat-cycle-tabs">
          {cycles.map((cycle) => (
            <Button
              key={cycle.pmo_uatcycleid}
              size="sm"
              variant={selected?.pmo_uatcycleid === cycle.pmo_uatcycleid ? 'default' : 'outline'}
              onClick={() => setSelectedId(cycle.pmo_uatcycleid)}
            >
              {cycle.pmo_name}
            </Button>
          ))}
        </div>
      )}

      {selected && (
        <section className="space-y-4 rounded-md border border-border p-4" aria-label="Cycle detail">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cycle-status">Status</Label>
              <select
                id="cycle-status"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={selected.pmo_status ?? UAT_CYCLE_STATUS.Planned}
                onChange={(e) => void handleStatus(
                  selected.pmo_uatcycleid, Number(e.target.value), selected.pmo_status,
                )}
              >
                {Object.values(UAT_CYCLE_STATUS).map((value) => (
                  <option key={value} value={value}>{UAT_CYCLE_STATUS_LABELS[value]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-4" data-testid="uat-cycle-dates">
            {([
              ['Planned start', 'pmo_plannedstart'],
              ['Planned end', 'pmo_plannedend'],
              ['Actual start', 'pmo_actualstart'],
              ['Actual end', 'pmo_actualend'],
            ] as const).map(([label, field]) => (
              <div key={field} className="space-y-1.5">
                <Label htmlFor={`cycle-${field}`}>{label}</Label>
                <Input
                  id={`cycle-${field}`}
                  type="date"
                  defaultValue={(selected[field] ?? '').slice(0, 10)}
                  onBlur={(e) => void handleField(selected.pmo_uatcycleid, {
                    [field]: e.target.value || null,
                  } as UatCycleUpdate)}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Planned and actual are kept separately. A cycle that started late is a fact worth
            keeping — overwriting the plan with what happened makes every later report say
            "on track".
          </p>

          <UatPaceChart
            cycle={{
              cycleId: selected.pmo_uatcycleid,
              name: selected.pmo_name,
              plannedStart: selected.pmo_plannedstart,
              plannedEnd: selected.pmo_plannedend,
            }}
            cases={cycleCases}
            today={todayIso()}
          />

          <p className="text-xs text-muted-foreground">
            {cycleCases.length} test case{cycleCases.length === 1 ? '' : 's'} assigned to this
            cycle. Assign a case to a cycle from the case itself.
          </p>

          <UatEvidenceFor parent="Cycle" recordId={selected.pmo_uatcycleid} projectId={projectId} />
        </section>
      )}
    </div>
  );
}

export default CycleDetailPage;
