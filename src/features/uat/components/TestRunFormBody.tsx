/**
 * One run being worked — the half of the run form that needs a run to already exist.
 *
 * WHY THIS IS ITS OWN FILE AND ITS OWN COMPONENT. `useUatTimer` opens, reconciles and persists
 * a single run's ledger in a lazy initializer, which requires the run id up front. A component
 * that also renders *before* the run exists cannot hold that hook — the alternative is an
 * effect that re-syncs timer state once the id arrives, which is both a lint error in this repo
 * and the exact shape that let a tick read a half-opened ledger (see useUatTimer's header).
 * `TestRunForm` mounts this with `key={run.pmo_uattestrunid}`, so there is one timer instance
 * per run and the ledger is opened exactly once.
 *
 * ONE ANSWER ROW PER QUESTION, WITH SNAPSHOTS. Each row carries `pmo_questiontextsnapshot` —
 * what was actually asked — and `pmo_responselabelsnapshot` — the outcome label as the tester
 * read it. Those two columns are why configurable questions are safe: without them, editing a
 * template would silently rewrite the meaning of every historical run, which is worse than the
 * fixed columns being replaced (FR-015). History displays the snapshot, never the joined
 * question.
 *
 * THE THREE MINUTE OUTCOMES ARE KEPT DISTINGUISHABLE BY QUERY, NOT BY READING TEXT:
 *
 *   - measured   → `pmo_minutes` from the ledger, `pmo_minutesoverridden` explicitly FALSE.
 *                  Never left null, so "how much of this metric was measured?" is a filter.
 *   - hand-typed → the tester's number, `pmo_minutesoverridden` TRUE, and the measured detail
 *                  kept in the comments so the typed figure never quietly replaces what was
 *                  observed (FR-019).
 *   - proposed   → no ledger survived, so the wall-clock span is OFFERED for the tester to
 *                  accept or correct, recorded as an override either way, never written
 *                  silently, and never blocking the save (FR-020).
 *
 * AN AD-HOC CASE HAS NO QUESTIONS, and gets no invented ones. It records a single outcome and
 * writes ZERO answer rows — a row carrying a made-up question like "Overall result" would be
 * indistinguishable from real template content, which is finding 31's rule. Its result still
 * goes through the same derivation, so ad-hoc and templated runs cannot end up under two
 * different status rules.
 *
 * SET-ALL-RESULTS IS LOCAL AND ONLY TOUCHES UNANSWERED QUESTIONS. The legacy equivalent was an
 * activated business rule that fanned one field into fourteen, and it was one of the three
 * places the thirteen questions were enumerated. `applyToUnanswered` below patches form state
 * and writes nothing, so the count follows whatever the template says today.
 *
 * WHAT IS NOT HERE: evidence capture is Phase 6. Every write's toast and telemetry row belong to
 * useAppMutation.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, Bug, Clock, Loader2, Pause, Play } from 'lucide-react';
import { DialogFooter } from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { Badge } from '../../../components/ui/badge';
import { Skeleton } from '../../../components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { UAT_OUTCOME, UAT_OUTCOME_LABELS } from '../../../lib/uatOptionSets';
import { useUatTemplateQuestions } from '../../../hooks/useUatTemplates';
import { useCreateUatTestRunAnswer, useUpdateUatTestRun } from '../../../hooks/useUatTestRuns';
import { useUpdateUatTestCase, useCoverageForTestCase } from '../../../hooks/useUatTestCases';
import { deriveCaseStatus, deriveRunSave, deriveRunResult } from '../lib/uatStatus';
import { DEFAULT_OBSERVED_VALUE_LABEL, groupQuestionsBySection } from '../lib/questionGrouping';
import { clearLedger, useUatTimer } from '../hooks/useUatTimer';
import { EMPTY_DRAFT, OUTCOME_OPTIONS, inputType, observedFields, type AnswerDraft } from './runAnswerFields';
import { SetAllResultsButton } from './SetAllResultsButton';
import { UatEvidenceFor } from './UatAttachmentMounts';
import { DefectCreateDialog } from './DefectCreateDialog';
import type { UatTemplateQuestion } from '../../../models/uatTemplate.model';
import type { UatTestRun } from '../../../models/uatTestRun.model';

export interface TestRunFormBodyProps {
  run: UatTestRun;
  testCaseId: string;
  projectId: string;
  /** The case's template, or null for an ad-hoc case. */
  templateId: string | null;
  onCancel: () => void;
  onCompleted: () => void;
}

export function TestRunFormBody({
  run,
  testCaseId,
  projectId,
  templateId,
  onCancel,
  onCompleted,
}: TestRunFormBodyProps) {
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({});
  const [adHocOutcome, setAdHocOutcome] = useState<number | null>(null);
  const [runComments, setRunComments] = useState('');
  const [typedMinutes, setTypedMinutes] = useState('');
  const [minutesTouched, setMinutesTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [defectOpen, setDefectOpen] = useState(false);

  /**
   * The requirement to pre-link on a defect — ONLY when the case covers exactly one.
   *
   * With two coverage links there is no non-arbitrary choice, and a guessed requirement is
   * worse than none: it puts a defect in a coverage report it does not belong to. So the
   * defect is raised unlinked on that side and the requirement can be set later.
   */
  const { data: coverage = [] } = useCoverageForTestCase(testCaseId);
  const soleRequirementId = coverage.length === 1
    ? coverage[0]._pmo_requirement_value
    : null;

  const { data: questions = [], isLoading: questionsLoading, isError: questionsError } =
    useUatTemplateQuestions(templateId ?? undefined);
  const updateRun = useUpdateUatTestRun(testCaseId);
  const createAnswer = useCreateUatTestRunAnswer(run.pmo_uattestrunid);
  const updateCase = useUpdateUatTestCase(projectId);

  const timer = useUatTimer({
    runId: run.pmo_uattestrunid,
    // A run row always carries pmo_startedon — it is written at creation. The fallback keeps
    // the type honest for a row read back from a model-driven edit that cleared it.
    startedOn: run.pmo_startedon ?? new Date().toISOString(),
  });

  const groups = useMemo(() => groupQuestionsBySection(questions), [questions]);
  const isAdHoc = !templateId;

  /**
   * The minutes that will be written, and whether that counts as an override.
   *
   * A proposal is an override BY DEFINITION — FR-020 requires the wall-clock span to be
   * recorded as one — so accepting the proposed figure untouched still sets the flag, and the
   * tester is told so rather than it happening quietly.
   */
  const minutesToWrite = minutesTouched ? Number(typedMinutes) : timer.minutes;
  const isOverride = minutesTouched || timer.isProposal;
  const minutesValid = !minutesTouched
    || (typedMinutes.trim() !== '' && Number.isInteger(Number(typedMinutes)) && Number(typedMinutes) >= 0);
  const shownMinutes = minutesTouched ? typedMinutes : String(timer.minutes);

  function draftFor(question: UatTemplateQuestion): AnswerDraft {
    return drafts[question.pmo_uattemplatequestionid] ?? EMPTY_DRAFT;
  }

  /**
   * The result this run WOULD save right now, from the same derivation the save uses.
   *
   * Read through `deriveRunResult` rather than by looking for a Fail among the drafts: the
   * precedence order is the module's to own, and a second reading of "is this run failing"
   * would be a second place for it to be wrong.
   */
  const liveResult = deriveRunResult(
    isAdHoc
      ? [{ pmo_outcome: adHocOutcome }]
      : questions.map((q) => ({ pmo_outcome: draftFor(q).outcome })),
    { questionCount: isAdHoc ? 1 : questions.length },
  );

  function setDraft(questionId: string, patch: Partial<AnswerDraft>) {
    setDrafts((prev) => ({
      ...prev,
      [questionId]: { ...(prev[questionId] ?? EMPTY_DRAFT), ...patch },
    }));
  }

  /** Questions with no outcome chosen yet. What set-all-results is allowed to touch. */
  const unanswered = questions.filter((q) => draftFor(q).outcome == null);

  /**
   * T028: one outcome across every UNANSWERED question, in local state only.
   *
   * The filter is the guard and it is the whole point: a tester marks the two questions that
   * failed and then bulk-passes the rest. Overwriting a deliberate answer would destroy the
   * findings the run exists to record, and the destruction would be invisible — every question
   * would read Pass and the run would look complete.
   */
  function applyToUnanswered(outcome: number) {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const question of questions) {
        const id = question.pmo_uattemplatequestionid;
        const existing = next[id] ?? EMPTY_DRAFT;
        if (existing.outcome != null) continue;
        next[id] = { ...existing, outcome };
      }
      return next;
    });
  }

  async function handleSave() {
    if (!minutesValid) return;
    setSaving(true);
    try {
      // One row per question, each carrying what was asked and what was read. Sequential
      // rather than parallel: a partial failure then leaves a contiguous prefix, which a
      // person can look at, instead of an arbitrary subset.
      for (const question of questions) {
        const draft = draftFor(question);
        await createAnswer.mutateAsync({
          'pmo_TestRun@odata.bind': `/pmo_uattestruns(${run.pmo_uattestrunid})`,
          'pmo_TemplateQuestion@odata.bind': `/pmo_uattemplatequestions(${question.pmo_uattemplatequestionid})`,
          // The snapshots. Taken from the question as displayed, never re-joined later.
          pmo_questiontextsnapshot: question.pmo_questiontext,
          pmo_responselabelsnapshot: draft.outcome == null ? null : UAT_OUTCOME_LABELS[draft.outcome],
          pmo_outcome: draft.outcome,
          pmo_sequence: question.pmo_sequence,
          pmo_comment: draft.comment.trim() || null,
          ...observedFields(question.pmo_responsetype, draft.observed),
        });
      }

      const answers = isAdHoc
        ? [{ pmo_outcome: adHocOutcome }]
        : questions.map((q) => ({ pmo_outcome: draftFor(q).outcome }));
      const derived = deriveRunSave(answers, { questionCount: isAdHoc ? 1 : questions.length });

      // FR-019: an override keeps the measured detail beside it, so a typed number never
      // quietly replaces what was observed.
      const comments = [runComments.trim(), isOverride ? timer.detail : '']
        .filter(Boolean)
        .join('\n\n') || null;

      await updateRun.mutateAsync({
        id: run.pmo_uattestrunid,
        payload: {
          pmo_completedon: new Date().toISOString(),
          pmo_minutes: minutesToWrite,
          // Explicitly false on a measured save. Never left null, so absence never needs
          // interpreting and "was this measured?" stays a filter.
          pmo_minutesoverridden: isOverride,
          pmo_comments: comments,
          ...derived,
        },
      });

      await updateCase.mutateAsync({
        id: testCaseId,
        payload: {
          pmo_executionstatus: deriveCaseStatus({
            pmo_iscurrent: true,
            pmo_runnumber: run.pmo_runnumber,
            pmo_status: derived.pmo_status,
          }),
        },
      });

      // The measure is now in Dataverse; the local ledger has nothing left to protect.
      clearLedger(run.pmo_uattestrunid);
      onCompleted();
    }
    catch {
      // Toasted and logged by useAppMutation. Staying open keeps every entered answer.
    }
    finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="space-y-5">
        {/* The measure, always visible, never something to type. */}
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 p-3">
          <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="font-mono text-sm tabular-nums">{timer.display}</span>
          {timer.isRunning
            ? (
                <Button variant="outline" size="sm" onClick={timer.pause}>
                  <Pause className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Pause
                </Button>
              )
            : (
                <Button variant="outline" size="sm" onClick={timer.resume}>
                  <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Resume
                </Button>
              )}
          {!timer.isRunning && <Badge variant="outline">Paused — not counted</Badge>}
          {timer.isProposal && <Badge variant="secondary">Proposed from the clock</Badge>}
        </div>

        {timer.isProposal && (
          <p
            role="status"
            className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            <span>
              This run was started somewhere this browser cannot see, so its pauses are unknown.
              {' '}<strong>{timer.minutes} minutes</strong> is the whole span since it began —
              accept it or correct it below. Either way it is recorded as entered by hand, not
              measured.
            </span>
          </p>
        )}

        {isAdHoc
          ? (
              <div className="space-y-1.5">
                <Label htmlFor="uat-run-adhoc-outcome">Outcome</Label>
                <Select
                  value={adHocOutcome == null ? '' : String(adHocOutcome)}
                  onValueChange={(v) => setAdHocOutcome(Number(v))}
                >
                  <SelectTrigger id="uat-run-adhoc-outcome">
                    <SelectValue placeholder="Not answered" />
                  </SelectTrigger>
                  <SelectContent>
                    {OUTCOME_OPTIONS.map((value) => (
                      <SelectItem key={value} value={String(value)}>
                        {UAT_OUTCOME_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )
          : questionsError
            ? (
                <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4" aria-hidden />
                  This template’s questions could not be loaded, so the run cannot be answered
                  yet. The run itself is recorded and still open.
                </p>
              )
            : questionsLoading
              ? <Skeleton className="h-40 w-full" />
              : questions.length === 0
                ? (
                    <p className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
                      This template has no questions yet. Add them under UAT → Templates, then
                      start a new run.
                    </p>
                  )
                : (
                  <>
                    <SetAllResultsButton
                      unansweredCount={unanswered.length}
                      onApply={applyToUnanswered}
                      disabled={saving}
                    />
                    {groups.map((group) => (
                    <fieldset key={group.section} className="space-y-3">
                      <legend className="text-sm font-semibold">
                        {group.section}
                        {group.isUngrouped && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            (no section set)
                          </span>
                        )}
                      </legend>
                      {group.questions.map((question) => {
                        const id = question.pmo_uattemplatequestionid;
                        const draft = draftFor(question);
                        return (
                          <div key={id} className="space-y-2 rounded-md border p-3">
                            <p className="text-sm font-medium">
                              {question.pmo_questiontext}
                              {question.pmo_isrequired && (
                                <span aria-hidden className="ml-1 text-destructive">*</span>
                              )}
                            </p>
                            {question.pmo_helptext && (
                              <p className="text-xs text-muted-foreground">{question.pmo_helptext}</p>
                            )}

                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="space-y-1.5">
                                <Label htmlFor={`outcome-${id}`}>Outcome</Label>
                                <Select
                                  value={draft.outcome == null ? '' : String(draft.outcome)}
                                  onValueChange={(v) => setDraft(id, { outcome: Number(v) })}
                                >
                                  <SelectTrigger id={`outcome-${id}`}>
                                    <SelectValue placeholder="Not answered" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {OUTCOME_OPTIONS.map((value) => (
                                      <SelectItem key={value} value={String(value)}>
                                        {UAT_OUTCOME_LABELS[value]}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              {question.pmo_capturesobservedvalue && (
                                <div className="space-y-1.5">
                                  {/* A null label renders the neutral fallback rather than an
                                      invented product term — finding 31. */}
                                  <Label htmlFor={`observed-${id}`}>
                                    {question.pmo_observedvaluelabel?.trim() || DEFAULT_OBSERVED_VALUE_LABEL}
                                  </Label>
                                  <Input
                                    id={`observed-${id}`}
                                    type={inputType(question.pmo_responsetype)}
                                    value={draft.observed}
                                    onChange={(e) => setDraft(id, { observed: e.target.value })}
                                  />
                                </div>
                              )}
                            </div>

                            {question.pmo_allowscomment && (
                              <div className="space-y-1.5">
                                <Label htmlFor={`comment-${id}`}>Comment</Label>
                                <Textarea
                                  id={`comment-${id}`}
                                  rows={2}
                                  value={draft.comment}
                                  onChange={(e) => setDraft(id, { comment: e.target.value })}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                      </fieldset>
                    ))}
                  </>
                  )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="uat-run-minutes">Minutes</Label>
            <Input
              id="uat-run-minutes"
              inputMode="numeric"
              value={shownMinutes}
              aria-invalid={!minutesValid}
              aria-describedby="uat-run-minutes-help"
              onChange={(e) => {
                setMinutesTouched(true);
                setTypedMinutes(e.target.value);
              }}
            />
            <p id="uat-run-minutes-help" className="text-xs text-muted-foreground">
              {isOverride
                ? 'Recorded as entered by hand. The measured detail is kept in the comments.'
                : 'Measured while you worked. Change it only if it is wrong.'}
            </p>
            {!minutesValid && (
              <p role="alert" className="text-xs text-destructive">
                Minutes must be a whole number of zero or more.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="uat-run-comments">Run comments</Label>
            <Textarea
              id="uat-run-comments"
              rows={3}
              value={runComments}
              onChange={(e) => setRunComments(e.target.value)}
            />
          </div>
        </div>

        {/* Evidence attaches to the RUN, not to the case: it is what this attempt saw. The
            run row already exists — the timer started it — so the panel is live while the
            tester is still working, which is when a screenshot is worth pasting. */}
        <UatEvidenceFor
          parent="TestRun"
          recordId={run.pmo_uattestrunid}
          projectId={projectId}
        />
      </div>

      <DialogFooter className="sm:justify-between">
        {/* A defect is raised from the run that found it, WHILE the tester still has the
            detail in mind — so the offer appears as soon as an answer reads Fail, not after
            the run is closed and they have moved on. The run row already exists, so all three
            links are available to pre-fill. */}
        {liveResult === UAT_OUTCOME.Fail ? (
          <Button variant="outline" onClick={() => setDefectOpen(true)} disabled={saving}>
            <Bug className="mr-1.5 h-4 w-4" aria-hidden /> Raise a defect
          </Button>
        ) : <span />}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button onClick={() => void handleSave()} disabled={saving || !minutesValid}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Complete run
          </Button>
        </div>
      </DialogFooter>

      <DefectCreateDialog
        open={defectOpen}
        onOpenChange={setDefectOpen}
        projectId={projectId}
        testCaseId={testCaseId}
        testRunId={run.pmo_uattestrunid}
        requirementId={soleRequirementId}
        moveCaseToReturned
      />
    </>
  );
}
