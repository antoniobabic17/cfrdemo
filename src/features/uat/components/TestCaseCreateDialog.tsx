/**
 * Create a test case — from a template, or ad hoc with no template.
 *
 * FR-013 requires both paths, and they differ by exactly two columns: `pmo_template` and
 * `pmo_source`. Setting one without the other is the failure worth guarding, because the
 * result reads correctly on the form and lies in every report — a case sourced `AdHoc`
 * that in fact runs a template's questions, or the reverse. So both are derived from one
 * piece of state, the chosen template id, and never set independently.
 *
 * THE INITIAL STATUS IS ASKED FOR, NOT ASSERTED. `pmo_executionstatus` comes from
 * `deriveCaseStatusFromRuns([])` rather than from a literal Not Started. A new case has no
 * runs, and "no runs means Not Started" is a rule that belongs in one place — writing the
 * value here would be a second copy of it, which is how the legacy rollup and its
 * calculated string came to disagree.
 *
 * RE-PARENTING IS NOT SUPPORTED, AND THIS SAYS SO. `pmo_uattestrun.pmo_project`
 * duplicates the case's project so run-level reporting needs no join, which is what keeps
 * portfolio rollups inside the aggregate ceiling — and it carries the obligation that
 * moving a case must move its runs' copy with it (data-model.md §4.2). Rather than
 * implement a multi-row cascade for an operation nothing in the spec asks for — where a
 * failure part-way leaves the two references split, which is worse than the operation not
 * existing — the project is fixed at creation. Stated here in the dialog, and enforced in
 * `useUpdateUatTestCase`, which strips a project bind rather than trusting callers to
 * have read the data model. A rule that only one of those two does is a rule that holds
 * for whoever remembers it.
 *
 * The success and failure toast belongs to useAppMutation; this component adds none (see
 * finding 34 — sibling hooks that toast in their own onError double-toast).
 */
import { useState } from 'react';
import { Loader2, Info } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { UAT_PRIORITY, UAT_PRIORITY_LABELS, UAT_SOURCE } from '../../../lib/uatOptionSets';
import { useCreateUatTestCase } from '../../../hooks/useUatTestCases';
import { useActiveUatTemplates } from '../../../hooks/useUatTemplates';
import { deriveCaseStatusFromRuns } from '../lib/uatStatus';
import { TemplatePicker } from './TemplatePicker';

export interface TestCaseCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project the case belongs to. Fixed for the life of the case — see the header. */
  projectId: string;
  /** Pre-selects a template, e.g. the project's default. Still overridable. */
  defaultTemplateId?: string | null;
  /** Called with the new case's id so the caller can navigate to it. */
  onCreated?: (id: string) => void;
}

const TITLE_MAX = 400;
const OBJECTIVE_MAX = 2000;
/** pmo_estimatedminutes is an int; a day of testing is already an outlier. */
const MINUTES_MAX = 10_000;

export function TestCaseCreateDialog({
  open,
  onOpenChange,
  projectId,
  defaultTemplateId = null,
  onCreated,
}: TestCaseCreateDialogProps) {
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(defaultTemplateId);
  const [priority, setPriority] = useState<number>(UAT_PRIORITY.Medium);
  const [typedMinutes, setTypedMinutes] = useState('');
  const [minutesTouched, setMinutesTouched] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [minutesError, setMinutesError] = useState<string | null>(null);

  const createTestCase = useCreateUatTestCase(projectId);
  const { data: templates = [] } = useActiveUatTemplates();

  /**
   * The default template can arrive AFTER mount — it comes from the project's settings
   * row (T044), which is a separate query — so the initial state alone would silently
   * drop it.
   *
   * Adjusted during render rather than in an effect. React supports this shape for
   * "a prop changed, so derive fresh state from it", and an effect here is what
   * react-hooks/set-state-in-effect exists to stop: it renders once with the stale value
   * before correcting itself, which for a form means a visible flicker on the control the
   * user is about to use.
   */
  const [appliedDefault, setAppliedDefault] = useState(defaultTemplateId);
  if (defaultTemplateId !== appliedDefault) {
    setAppliedDefault(defaultTemplateId);
    setTemplateId(defaultTemplateId);
  }

  /**
   * A template's default estimate fills the field until the user types their own, at
   * which point their value wins for good — overwriting a deliberate number on the next
   * template change is worse than not suggesting one at all.
   *
   * DERIVED, not synchronised. Holding the suggestion in state would mean two sources for
   * one displayed value, kept in step by an effect that has to fire in the right order
   * relative to the user's keystrokes.
   */
  const chosenTemplate = templates.find((t) => t.pmo_uattemplateid === templateId);
  const suggestedMinutes = chosenTemplate?.pmo_defaultestimatedminutes;
  const minutes = minutesTouched
    ? typedMinutes
    : suggestedMinutes == null ? '' : String(suggestedMinutes);

  function reset() {
    setTitle('');
    setObjective('');
    setTemplateId(defaultTemplateId);
    setPriority(UAT_PRIORITY.Medium);
    setTypedMinutes('');
    setMinutesTouched(false);
    setTitleError(null);
    setMinutesError(null);
  }

  function cancel() {
    // Cancel discards, predictably. Calling onOpenChange straight from the button would
    // leave the typed values behind for the next open — Radix does not re-fire its own
    // onOpenChange when the parent closes it.
    reset();
    onOpenChange(false);
  }

  function validate(): boolean {
    let ok = true;
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError('A test case needs a title.');
      ok = false;
    }
    else if (trimmed.length > TITLE_MAX) {
      setTitleError(`Keep the title to ${TITLE_MAX} characters or fewer.`);
      ok = false;
    }
    else setTitleError(null);

    if (minutes.trim()) {
      const parsed = Number(minutes);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > MINUTES_MAX) {
        setMinutesError(`Estimated minutes must be a whole number from 0 to ${MINUTES_MAX}.`);
        ok = false;
      }
      else setMinutesError(null);
    }
    else setMinutesError(null);

    return ok;
  }

  async function handleSave() {
    if (!validate()) return;
    try {
      const created = await createTestCase.mutateAsync({
        pmo_title: title.trim(),
        pmo_objective: objective.trim() || null,
        pmo_priority: priority,
        pmo_estimatedminutes: minutes.trim() ? Number(minutes) : null,
        // One template id decides both columns. See the header.
        'pmo_Template@odata.bind': templateId ? `/pmo_uattemplates(${templateId})` : null,
        pmo_source: templateId ? UAT_SOURCE.Template : UAT_SOURCE.AdHoc,
        // A case with no runs. Asked, not asserted.
        pmo_executionstatus: deriveCaseStatusFromRuns([]),
      });
      reset();
      onOpenChange(false);
      onCreated?.(created.pmo_uattestcaseid);
    }
    catch {
      // useAppMutation has toasted and logged. Staying open keeps what was typed.
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
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New test case</DialogTitle>
          <DialogDescription>
            A test case is one thing to verify. Base it on a template to reuse an agreed
            set of questions, or create it on its own and give it questions later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="uat-case-title">
              Title <span aria-hidden className="text-destructive">*</span>
              <span className="sr-only">(required)</span>
            </Label>
            <Input
              id="uat-case-title"
              value={title}
              maxLength={TITLE_MAX}
              aria-required
              aria-invalid={!!titleError}
              aria-describedby={titleError ? 'uat-case-title-error' : undefined}
              onChange={(e) => {
                setTitle(e.target.value);
                if (titleError) setTitleError(null);
              }}
              placeholder="What is being verified?"
            />
            {titleError && (
              <p id="uat-case-title-error" role="alert" className="text-xs text-destructive">
                {titleError}
              </p>
            )}
          </div>

          <TemplatePicker
            id="uat-case-template"
            label="Template"
            value={templateId}
            onChange={setTemplateId}
            noneLabel="No template (ad hoc)"
            description={
              templateId
                ? 'Runs of this case will ask this template’s questions, as they read at the time of the run.'
                : 'An ad-hoc case records its own result without a template’s question set.'
            }
          />

          <div className="space-y-1.5">
            <Label htmlFor="uat-case-objective">Objective</Label>
            <Textarea
              id="uat-case-objective"
              value={objective}
              maxLength={OBJECTIVE_MAX}
              rows={3}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="What does passing this case prove?"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="uat-case-priority">Priority</Label>
              <Select value={String(priority)} onValueChange={(next) => setPriority(Number(next))}>
                <SelectTrigger id="uat-case-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(UAT_PRIORITY).map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {UAT_PRIORITY_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="uat-case-minutes">Estimated minutes</Label>
              <Input
                id="uat-case-minutes"
                value={minutes}
                inputMode="numeric"
                aria-invalid={!!minutesError}
                aria-describedby={minutesError ? 'uat-case-minutes-error' : undefined}
                onChange={(e) => {
                  setMinutesTouched(true);
                  setTypedMinutes(e.target.value);
                  if (minutesError) setMinutesError(null);
                }}
                placeholder="Optional"
              />
              {minutesError && (
                <p id="uat-case-minutes-error" role="alert" className="text-xs text-destructive">
                  {minutesError}
                </p>
              )}
            </div>
          </div>

          {/* The invariant, where the decision is made rather than in a comment. */}
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              This case belongs to the project you are in, and cannot be moved to another
              one later. Its test runs keep their own copy of the project so reporting does
              not have to join back, and moving a case would leave the two out of step.
              Create the case in the project that owns the work.
            </span>
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={cancel} disabled={createTestCase.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={createTestCase.isPending}>
            {createTestCase.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Create test case
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
