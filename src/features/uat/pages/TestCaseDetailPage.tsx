/**
 * One test case: what it asks, and every attempt at answering it.
 *
 * THE RUN HISTORY IS THE POINT OF THIS PAGE. A re-test is a new `pmo_uattestrun`, never an
 * edit of the last one, so the list below is an append-only record and the current attempt
 * is marked rather than being "the row that got overwritten". Showing only the latest run
 * would hide exactly the history the immutability is there to preserve.
 *
 * STATUS IS READ, NOT RE-DERIVED. `pmo_executionstatus` was written on save from the case's
 * current run by `lib/uatStatus.ts`. This page shows the stored value and, beside it, which
 * run it came from — so a status that looks wrong can be traced to the attempt that produced
 * it instead of being taken on trust. Re-deriving here would be a second answer to a
 * question already answered, which is the legacy rollup-plus-calculated-string failure in
 * miniature.
 *
 * WHAT IS NOT HERE YET, and where it lands: evidence is Phase 6, defects are Phase 8, coverage
 * is Phase 10. Each will attach to this page. Running the case arrived with T027 — the button
 * below opens the run form, which stamps the start and begins measuring without the tester
 * typing anything.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ClipboardList, Edit3, Eye, Loader2, Play } from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { Skeleton } from '../../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import {
  UAT_EXECUTION_STATUS_LABELS,
  UAT_OUTCOME_LABELS,
  UAT_PRIORITY_LABELS,
  UAT_SOURCE_LABELS,
} from '../../../lib/uatOptionSets';
import { readProjectName, readProjectValue } from '../../../lib/projectLookupRef';
import { useUatTestCase, useUpdateUatTestCase } from '../../../hooks/useUatTestCases';
import { useUatCycles, useUatTestRunAnswers, useUatTestRuns } from '../../../hooks/useUatTestRuns';
import { selectCurrentRun } from '../lib/uatStatus';
import { UNSET_LABEL } from '../components/TestCaseTable';
import { TestRunForm } from '../components/TestRunForm';
import { UatEvidenceFor } from '../components/UatAttachmentMounts';
import { Textarea } from '../../../components/ui/textarea';
import type { UatTestCase, UatTestCaseUpdate } from '../../../models/uatTestCase.model';
import type { UatTestRun } from '../../../models/uatTestRun.model';

const NONE_VALUE = '__none__';
const TITLE_MAX = 400;
const MINUTES_MAX = 10_000;

function formatDate(value: string | null | undefined): string {
  if (!value) return UNSET_LABEL;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? UNSET_LABEL : parsed.toLocaleDateString();
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return UNSET_LABEL;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? UNSET_LABEL : parsed.toLocaleString();
}

function dateInputValue(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}

/** A labelled fact. Renders the dash rather than collapsing, so the gap stays visible. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function RunDetailsDialog({
  open,
  onOpenChange,
  run,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: UatTestRun | null;
  projectId: string | null;
}) {
  const { data: answers = [], isLoading, isError, refetch } = useUatTestRunAnswers(run?.pmo_uattestrunid);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{run ? `Run ${run.pmo_name}` : 'Run details'}</DialogTitle>
          <DialogDescription>
            Historical run details are read-only. Template edits do not rewrite the stored
            question text or response labels shown here.
          </DialogDescription>
        </DialogHeader>

        {run && (
          <div className="space-y-5">
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Fact label="Status">
                {run.pmo_status == null ? UNSET_LABEL : UAT_EXECUTION_STATUS_LABELS[run.pmo_status]}
              </Fact>
              <Fact label="Result">
                {run.pmo_result == null ? UNSET_LABEL : UAT_OUTCOME_LABELS[run.pmo_result]}
              </Fact>
              <Fact label="Started">{formatDateTime(run.pmo_startedon)}</Fact>
              <Fact label="Completed">{formatDateTime(run.pmo_completedon)}</Fact>
              <Fact label="Minutes">
                {run.pmo_minutes ?? UNSET_LABEL}
                {run.pmo_minutesoverridden === true && (
                  <span className="ml-1 text-xs text-muted-foreground">(entered)</span>
                )}
              </Fact>
              <Fact label="Current">{run.pmo_iscurrent === true ? 'Yes' : 'No'}</Fact>
            </dl>

            {run.pmo_comments && (
              <Fact label="Run comments">
                <p className="whitespace-pre-wrap">{run.pmo_comments}</p>
              </Fact>
            )}

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Stored answers</h3>
                {isError && (
                  <Button variant="outline" size="sm" onClick={() => void refetch()}>
                    Try again
                  </Button>
                )}
              </div>
              {isError
                ? <p role="alert" className="text-sm text-destructive">This run's answers could not be loaded.</p>
                : isLoading
                  ? <Skeleton className="h-24 w-full" />
                  : answers.length === 0
                    ? (
                        <p className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
                          No answer rows are stored for this run.
                        </p>
                      )
                    : (
                        <div className="overflow-x-auto rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Question snapshot</TableHead>
                                <TableHead>Result</TableHead>
                                <TableHead>Observed value</TableHead>
                                <TableHead>Comment</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {answers.map((answer) => (
                                <TableRow key={answer.pmo_uattestrunanswerid}>
                                  <TableCell>
                                    <div className="space-y-1">
                                      <p className="font-medium">{answer.pmo_questiontextsnapshot}</p>
                                      <p className="text-xs text-muted-foreground">
                                        Sequence {answer.pmo_sequence ?? UNSET_LABEL}
                                      </p>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    {answer.pmo_responselabelsnapshot
                                      ?? (answer.pmo_outcome == null ? UNSET_LABEL : UAT_OUTCOME_LABELS[answer.pmo_outcome])}
                                  </TableCell>
                                  <TableCell>
                                    {answer.pmo_observedvalue
                                      ?? answer.pmo_observednumber
                                      ?? answer.pmo_observeddate
                                      ?? UNSET_LABEL}
                                  </TableCell>
                                  <TableCell>{answer.pmo_comment ?? UNSET_LABEL}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
            </section>

            <UatEvidenceFor
              parent="TestRun"
              recordId={run.pmo_uattestrunid}
              projectId={projectId ?? undefined}
              readOnly
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TestCaseEditDialog({
  open,
  onOpenChange,
  testCase,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testCase: UatTestCase;
  projectId: string;
}) {
  const [title, setTitle] = useState(testCase.pmo_title);
  const [priority, setPriority] = useState<number | null>(testCase.pmo_priority);
  const [plannedStart, setPlannedStart] = useState(dateInputValue(testCase.pmo_plannedstart));
  const [plannedEnd, setPlannedEnd] = useState(dateInputValue(testCase.pmo_plannedend));
  const [cycleId, setCycleId] = useState(testCase._pmo_cycle_value ?? NONE_VALUE);
  const [estimatedMinutes, setEstimatedMinutes] = useState(
    testCase.pmo_estimatedminutes == null ? '' : String(testCase.pmo_estimatedminutes),
  );
  const [externalKey, setExternalKey] = useState(testCase.pmo_externalkey ?? '');
  const [objective, setObjective] = useState(testCase.pmo_objective ?? '');
  const [scenario, setScenario] = useState(testCase.pmo_scenario ?? '');
  const [preconditions, setPreconditions] = useState(testCase.pmo_preconditions ?? '');
  const [testData, setTestData] = useState(testCase.pmo_testdata ?? '');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [minutesError, setMinutesError] = useState<string | null>(null);

  const updateCase = useUpdateUatTestCase(projectId);
  const { data: cycles = [] } = useUatCycles(projectId);

  function reset(): void {
    setTitle(testCase.pmo_title);
    setPriority(testCase.pmo_priority);
    setPlannedStart(dateInputValue(testCase.pmo_plannedstart));
    setPlannedEnd(dateInputValue(testCase.pmo_plannedend));
    setCycleId(testCase._pmo_cycle_value ?? NONE_VALUE);
    setEstimatedMinutes(testCase.pmo_estimatedminutes == null ? '' : String(testCase.pmo_estimatedminutes));
    setExternalKey(testCase.pmo_externalkey ?? '');
    setObjective(testCase.pmo_objective ?? '');
    setScenario(testCase.pmo_scenario ?? '');
    setPreconditions(testCase.pmo_preconditions ?? '');
    setTestData(testCase.pmo_testdata ?? '');
    setTitleError(null);
    setMinutesError(null);
  }

  function validate(): boolean {
    let ok = true;
    if (!title.trim()) {
      setTitleError('A test case needs a title.');
      ok = false;
    }
    else if (title.trim().length > TITLE_MAX) {
      setTitleError(`Keep the title to ${TITLE_MAX} characters or fewer.`);
      ok = false;
    }
    else setTitleError(null);

    if (estimatedMinutes.trim()) {
      const parsed = Number(estimatedMinutes);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > MINUTES_MAX) {
        setMinutesError(`Estimated minutes must be a whole number from 0 to ${MINUTES_MAX}.`);
        ok = false;
      }
      else setMinutesError(null);
    }
    else setMinutesError(null);

    return ok;
  }

  async function handleSave(): Promise<void> {
    if (!validate()) return;
    const payload: UatTestCaseUpdate = {
      pmo_title: title.trim(),
      pmo_priority: priority,
      pmo_plannedstart: plannedStart || null,
      pmo_plannedend: plannedEnd || null,
      pmo_estimatedminutes: estimatedMinutes.trim() ? Number(estimatedMinutes) : null,
      pmo_externalkey: externalKey.trim() || null,
      pmo_objective: objective.trim() || null,
      pmo_scenario: scenario.trim() || null,
      pmo_preconditions: preconditions.trim() || null,
      pmo_testdata: testData.trim() || null,
      'pmo_Cycle@odata.bind': cycleId === NONE_VALUE ? null : `/pmo_uatcycles(${cycleId})`,
    };
    try {
      await updateCase.mutateAsync({ id: testCase.pmo_uattestcaseid, payload });
      onOpenChange(false);
    }
    catch {
      // useAppMutation owns the toast/logging; keep the dialog open with entered values.
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit test case details</DialogTitle>
          <DialogDescription>
            This updates the test-case metadata only. Completed run answers and question
            snapshots remain immutable.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="uat-case-edit-title">Title</Label>
            <Input
              id="uat-case-edit-title"
              value={title}
              maxLength={TITLE_MAX}
              aria-invalid={!!titleError}
              aria-describedby={titleError ? 'uat-case-edit-title-error' : undefined}
              onChange={(e) => {
                setTitle(e.target.value);
                if (titleError) setTitleError(null);
              }}
            />
            {titleError && <p id="uat-case-edit-title-error" role="alert" className="text-xs text-destructive">{titleError}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="uat-case-edit-priority">Priority</Label>
              <Select value={priority == null ? NONE_VALUE : String(priority)} onValueChange={(next) => setPriority(next === NONE_VALUE ? null : Number(next))}>
                <SelectTrigger id="uat-case-edit-priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>No priority</SelectItem>
                  {Object.entries(UAT_PRIORITY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="uat-case-edit-cycle">Cycle</Label>
              <Select value={cycleId} onValueChange={setCycleId}>
                <SelectTrigger id="uat-case-edit-cycle"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>No cycle</SelectItem>
                  {cycles.map((cycle) => (
                    <SelectItem key={cycle.pmo_uatcycleid} value={cycle.pmo_uatcycleid}>
                      {cycle.pmo_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="uat-case-edit-start">Planned start</Label>
              <Input id="uat-case-edit-start" type="date" value={plannedStart} onChange={(e) => setPlannedStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="uat-case-edit-end">Planned end</Label>
              <Input id="uat-case-edit-end" type="date" value={plannedEnd} onChange={(e) => setPlannedEnd(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="uat-case-edit-minutes">Estimated minutes</Label>
              <Input
                id="uat-case-edit-minutes"
                inputMode="numeric"
                value={estimatedMinutes}
                aria-invalid={!!minutesError}
                aria-describedby={minutesError ? 'uat-case-edit-minutes-error' : undefined}
                onChange={(e) => {
                  setEstimatedMinutes(e.target.value);
                  if (minutesError) setMinutesError(null);
                }}
              />
              {minutesError && <p id="uat-case-edit-minutes-error" role="alert" className="text-xs text-destructive">{minutesError}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="uat-case-edit-external-key">External key</Label>
              <Input id="uat-case-edit-external-key" value={externalKey} onChange={(e) => setExternalKey(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="uat-case-edit-objective">Objective</Label>
              <Textarea id="uat-case-edit-objective" value={objective} rows={3} onChange={(e) => setObjective(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="uat-case-edit-scenario">Scenario</Label>
              <Textarea id="uat-case-edit-scenario" value={scenario} rows={3} onChange={(e) => setScenario(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="uat-case-edit-preconditions">Preconditions</Label>
              <Textarea id="uat-case-edit-preconditions" value={preconditions} rows={3} onChange={(e) => setPreconditions(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="uat-case-edit-testdata">Test data</Label>
              <Textarea id="uat-case-edit-testdata" value={testData} rows={3} onChange={(e) => setTestData(e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }} disabled={updateCase.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={updateCase.isPending}>
            {updateCase.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Save test case
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TestCaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [runOpen, setRunOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedRun, setSelectedRun] = useState<UatTestRun | null>(null);
  const { data: testCase, isLoading, isError, refetch } = useUatTestCase(id);
  const {
    data: runs = [],
    isLoading: runsLoading,
    isError: runsError,
    refetch: refetchRuns,
  } = useUatTestRuns(id);

  if (isError) {
    return (
      <div className="p-6">
        <div className="rounded-xl border bg-muted/30 p-12 text-center">
          <p className="text-sm font-medium">This test case could not be loaded</p>
          <p className="mt-1 text-xs text-muted-foreground">
            A load failure, not a deleted test case.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void refetch()}>Try again</Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('/uat')}>
              Back to UAT
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading || !testCase || !id) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  // Which attempt the stored status came from. Same selector the derivation uses, so the
  // page cannot disagree with the value that was written.
  const currentRun = selectCurrentRun(runs);
  const projectName = readProjectName(testCase);
  // A run denormalizes its case's project, so the id is required before one can be started.
  const projectId = readProjectValue(testCase);

  return (
    <div className="space-y-6 p-6">
      <div>
        <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => navigate('/uat')}>
          <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden />
          UAT
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground">{testCase.pmo_name}</span>
          <h1 className="text-xl font-semibold">{testCase.pmo_title}</h1>
          {testCase.pmo_executionstatus != null && (
            <Badge variant="secondary">
              {UAT_EXECUTION_STATUS_LABELS[testCase.pmo_executionstatus]}
            </Badge>
          )}
        </div>
        {projectName && (
          <p className="mt-1 text-sm text-muted-foreground">{projectName}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setRunOpen(true)} disabled={!projectId}>
          <Play className="mr-1.5 h-4 w-4" aria-hidden />
          {runs.length === 0 ? 'Start run' : 'Start another run'}
        </Button>
        <Button variant="outline" onClick={() => setEditOpen(true)} disabled={!projectId}>
          <Edit3 className="mr-1.5 h-4 w-4" aria-hidden />
          Edit test case
        </Button>
        {!projectId && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            This case has no project reference, so a run cannot carry the project copy that
            run-level reporting needs. Fix the case before running it.
          </p>
        )}
      </div>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Priority">
          {testCase.pmo_priority == null ? UNSET_LABEL : UAT_PRIORITY_LABELS[testCase.pmo_priority]}
        </Fact>
        <Fact label="Source">
          {testCase.pmo_source == null ? UNSET_LABEL : UAT_SOURCE_LABELS[testCase.pmo_source]}
        </Fact>
        <Fact label="Template">
          {testCase._pmo_template_value
            ? (
                <Button
                  variant="link"
                  className="h-auto p-0 text-sm"
                  onClick={() => navigate(`/uat/templates/${testCase._pmo_template_value}`)}
                >
                  Open template
                </Button>
              )
            : <span className="text-muted-foreground">None — ad hoc</span>}
        </Fact>
        <Fact label="Planned start">{formatDate(testCase.pmo_plannedstart)}</Fact>
        <Fact label="Planned end">{formatDate(testCase.pmo_plannedend)}</Fact>
        <Fact label="Estimated minutes">{testCase.pmo_estimatedminutes ?? UNSET_LABEL}</Fact>
        <Fact label="Status from">
          {currentRun
            ? `${currentRun.pmo_name} (current attempt)`
            : <span className="text-muted-foreground">No runs yet</span>}
        </Fact>
        <Fact label="External key">
          {testCase.pmo_externalkey ?? <span className="text-muted-foreground">{UNSET_LABEL}</span>}
        </Fact>
      </dl>

      {(testCase.pmo_objective || testCase.pmo_scenario || testCase.pmo_preconditions
        || testCase.pmo_testdata) && (
        <dl className="grid gap-4 sm:grid-cols-2">
          {testCase.pmo_objective && (
            <Fact label="Objective">
              <p className="whitespace-pre-wrap">{testCase.pmo_objective}</p>
            </Fact>
          )}
          {testCase.pmo_scenario && (
            <Fact label="Scenario">
              <p className="whitespace-pre-wrap">{testCase.pmo_scenario}</p>
            </Fact>
          )}
          {testCase.pmo_preconditions && (
            <Fact label="Preconditions">
              <p className="whitespace-pre-wrap">{testCase.pmo_preconditions}</p>
            </Fact>
          )}
          {testCase.pmo_testdata && (
            <Fact label="Test data">
              <p className="whitespace-pre-wrap">{testCase.pmo_testdata}</p>
            </Fact>
          )}
        </dl>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h2 className="text-base font-semibold">Runs</h2>
          <span className="text-xs text-muted-foreground">
            {runs.length === 1 ? '1 attempt' : `${runs.length} attempts`}
          </span>
        </div>

        {runsError
          ? (
              <div
                role="alert"
                className="flex flex-col items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-6"
              >
                <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <AlertTriangle className="h-4 w-4" aria-hidden />
                  This case’s runs could not be loaded.
                </p>
                <p className="text-sm text-muted-foreground">
                  The case itself loaded fine — only its history is missing, so the status
                  above may not be explainable until this succeeds.
                </p>
                <Button variant="outline" size="sm" onClick={() => void refetchRuns()}>
                  Try again
                </Button>
              </div>
            )
          : runsLoading
            ? <Skeleton className="h-24 w-full" />
            : runs.length === 0
              ? (
                  <div className="rounded-xl border bg-muted/30 p-8 text-center">
                    <p className="text-sm font-medium">This case has not been run yet</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Its status stays Not Started until a first attempt is recorded.
                      Opening and answering a run arrives with the run form.
                    </p>
                  </div>
                )
              : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Run</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Result</TableHead>
                          <TableHead>Started</TableHead>
                          <TableHead>Completed</TableHead>
                          <TableHead className="text-right">Minutes</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {runs.map((r) => (
                          <TableRow key={r.pmo_uattestrunid}>
                            <TableCell className="font-medium tabular-nums">
                              {r.pmo_name}
                              {r.pmo_iscurrent === true && (
                                <Badge variant="outline" className="ml-2">Current</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {r.pmo_status == null
                                ? UNSET_LABEL
                                : UAT_EXECUTION_STATUS_LABELS[r.pmo_status]}
                            </TableCell>
                            <TableCell>
                              {r.pmo_result == null
                                ? UNSET_LABEL
                                : UAT_OUTCOME_LABELS[r.pmo_result]}
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {formatDateTime(r.pmo_startedon)}
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {formatDateTime(r.pmo_completedon)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {r.pmo_minutes ?? UNSET_LABEL}
                              {/* Measured vs typed is a query on this column, never a
                                  guess from the number — so the page says which it was. */}
                              {r.pmo_minutesoverridden === true && (
                                <span className="ml-1 text-xs text-muted-foreground">(entered)</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSelectedRun(r)}
                                aria-label={`Open run ${r.pmo_name}`}
                              >
                                <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                                Open
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
      </section>

      <UatEvidenceFor parent="TestCase" recordId={id} projectId={projectId} />

      {projectId && (
        <TestRunForm
          open={runOpen}
          onOpenChange={setRunOpen}
          testCaseId={id}
          projectId={projectId}
          templateId={testCase._pmo_template_value}
          existingRunCount={runs.length}
          onCompleted={() => {
            void refetch();
            void refetchRuns();
          }}
        />
      )}

      {projectId && (
        <TestCaseEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          testCase={testCase}
          projectId={projectId}
        />
      )}

      <RunDetailsDialog
        open={selectedRun !== null}
        onOpenChange={(next) => { if (!next) setSelectedRun(null); }}
        run={selectedRun}
        projectId={projectId ?? null}
      />
    </div>
  );
}

export default TestCaseDetailPage;
