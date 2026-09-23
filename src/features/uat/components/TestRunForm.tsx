/**
 * Start a run, then hand over to the form that works it.
 *
 * THE CLOCK STARTS WHEN THE RUN OPENS AND NOBODY TYPES ANYTHING (FR-017). Starting a run writes
 * the row with `pmo_startedon`, which is what the timer measures from. The legacy equivalent of
 * that number was hand-entered in `cr87a_minutestotest` and then filtered by a flow at a
 * hard-coded 240 — a figure nobody measured gating a process.
 *
 * AN OPENED RUN THAT IS ABANDONED STAYS. It is a truthful record: someone started work and
 * stopped. History is append-only, a re-test is a new run, and there is no "reset this run"
 * anywhere in this feature — so cancelling this dialog leaves the row and its local ledger
 * alone rather than tidying away a fact.
 *
 * WHY THE WORKING FORM IS A SEPARATE, KEYED COMPONENT. `useUatTimer` opens and reconciles one
 * run's ledger in a lazy initializer and therefore needs the run id at mount. This shell renders
 * before the run exists, so it cannot hold that hook; `TestRunFormBody` is mounted with
 * `key={run.pmo_uattestrunid}` and owns the timer for exactly that run. The alternative — an
 * effect that re-syncs timer state when the id arrives — is a lint error in this repo and is
 * the shape that let a tick read a half-opened ledger.
 */
import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { useUatTemplateQuestions } from '../../../hooks/useUatTemplates';
import { useStartUatTestRun } from '../../../hooks/useUatTestRuns';
import { useUpdateUatTestCase } from '../../../hooks/useUatTestCases';
import { deriveCaseStatus, deriveRunSave } from '../lib/uatStatus';
import { TestRunFormBody } from './TestRunFormBody';
import type { UatTestRun } from '../../../models/uatTestRun.model';

export interface TestRunFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testCaseId: string;
  projectId: string;
  /** The case's template, or null for an ad-hoc case. */
  templateId: string | null;
  /** How many runs the case already has, so the new one gets the next number. */
  existingRunCount: number;
  /** A run already in progress to pick back up. Null starts a new one. */
  resumeRun?: UatTestRun | null;
  onCompleted?: () => void;
}

export function TestRunForm({
  open,
  onOpenChange,
  testCaseId,
  projectId,
  templateId,
  existingRunCount,
  resumeRun = null,
  onCompleted,
}: TestRunFormProps) {
  const [run, setRun] = useState<UatTestRun | null>(resumeRun);
  const [startError, setStartError] = useState(false);

  const { data: questions = [] } = useUatTemplateQuestions(templateId ?? undefined);
  const startRun = useStartUatTestRun(testCaseId, projectId);
  const updateCase = useUpdateUatTestCase(projectId);
  const isAdHoc = !templateId;

  function close() {
    setRun(resumeRun);
    setStartError(false);
    onOpenChange(false);
  }

  /** Create the run row, which is what stamps the start and begins the measure. */
  async function handleStart() {
    setStartError(false);
    try {
      const created = await startRun.mutateAsync({
        'pmo_TestCase@odata.bind': `/pmo_uattestcases(${testCaseId})`,
        // Integer, explicitly. Dataverse refuses a fractional value for an Edm.Int32 — the
        // same trap that turned 13 + 1 into '14.0' in the DEV scripts (finding 42).
        pmo_runnumber: Math.trunc(existingRunCount) + 1,
        pmo_startedon: new Date().toISOString(),
        // An opened run is in process. Written now, so a live board is right before the first
        // answer rather than only after the save. Asked of the derivation, not asserted here.
        pmo_status: deriveRunSave([], { questionCount: questions.length || 1 }).pmo_status,
      });
      setRun(created);
      // The case follows its current run, which is now this one.
      await updateCase
        .mutateAsync({
          id: testCaseId,
          payload: { pmo_executionstatus: deriveCaseStatus({ ...created, pmo_iscurrent: true }) },
        })
        .catch(() => undefined);
    }
    catch {
      // useAppMutation has toasted and logged. The dialog stays open and offers a retry rather
      // than closing on the tester.
      setStartError(true);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{run ? `Run ${run.pmo_name}` : 'Start a run'}</DialogTitle>
          <DialogDescription>
            {isAdHoc
              ? 'This case has no template, so record its outcome directly.'
              : 'Answer each question as you work through it. What you are asked here is stored with your answer, so a later template change will not rewrite this record.'}
          </DialogDescription>
        </DialogHeader>

        {run
          ? (
              <TestRunFormBody
                key={run.pmo_uattestrunid}
                run={run}
                testCaseId={testCaseId}
                projectId={projectId}
                templateId={templateId}
                onCancel={close}
                onCompleted={() => { close(); onCompleted?.(); }}
              />
            )
          : (
              <>
                <p className="text-sm text-muted-foreground">
                  Starting the run records the time it began and starts measuring. You will not
                  have to type a duration.
                </p>
                {startError && (
                  <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4" aria-hidden />
                    The run could not be started. Nothing was recorded — try again.
                  </p>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={close} disabled={startRun.isPending}>
                    Cancel
                  </Button>
                  <Button onClick={() => void handleStart()} disabled={startRun.isPending}>
                    {startRun.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                    Start run
                  </Button>
                </DialogFooter>
              </>
            )}
      </DialogContent>
    </Dialog>
  );
}
