/**
 * Edit the questions on one template.
 *
 * This component IS user story 1. Everything the run form must honour is editable here
 * — text, answer type, required, captures-observed-value with its label, allows-comment,
 * allows-attachment, section, and order — and every change is a row write. No schema
 * change, no deploy.
 *
 * NO RESPONSE-SET EDITOR, deliberately. The outcome vocabulary is the single global
 * choice pmo_uatoutcome; pmo_responsetype below is the INPUT type, which is a different
 * thing. Option A removed the response-set table, so there is nothing here to edit and
 * adding an editor would imply a second vocabulary exists.
 *
 * NULLS ARE REAL HERE AND MUST NOT BE INVENTED AWAY — see lib/questionGrouping.ts, which
 * owns the grouping rule and the fallback labels because the run form (Phase 5) must show
 * the tester exactly what the author sees here.
 *
 * REORDER REWRITES pmo_sequence rather than moving rows, so the sequence is the display
 * contract. Each move issues its own update through useAppMutation, so a partial failure
 * leaves a recoverable order and a logged error instead of a silent half-apply.
 */
import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { Badge } from '../../../components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { UAT_RESPONSE_TYPE, UAT_RESPONSE_TYPE_LABELS } from '../../../lib/uatOptionSets';
import {
  useUatTemplateQuestions,
  useCreateUatTemplateQuestion,
  useUpdateUatTemplateQuestion,
  useDeleteUatTemplateQuestion,
  useReorderUatTemplateQuestions,
} from '../../../hooks/useUatTemplates';
import type { UatTemplateQuestion } from '../../../models/uatTemplate.model';
import {
  groupQuestionsBySection,
  DEFAULT_OBSERVED_VALUE_LABEL,
} from '../lib/questionGrouping';

export interface TemplateQuestionEditorProps {
  templateId: string;
  /** False for a read-only viewer; the editor still renders, controls disable. */
  canEdit: boolean;
}

export function TemplateQuestionEditor({ templateId, canEdit }: TemplateQuestionEditorProps) {
  const { data: questions = [], isLoading, isError, refetch } = useUatTemplateQuestions(templateId);
  const createQuestion = useCreateUatTemplateQuestion(templateId);
  const updateQuestion = useUpdateUatTemplateQuestion(templateId);
  const deleteQuestion = useDeleteUatTemplateQuestion(templateId);
  const reorder = useReorderUatTemplateQuestions(templateId);

  const [pendingDelete, setPendingDelete] = useState<UatTemplateQuestion | null>(null);
  const [newText, setNewText] = useState('');
  const [newTextError, setNewTextError] = useState<string | null>(null);

  const groups = useMemo(() => groupQuestionsBySection(questions), [questions]);
  const busy = createQuestion.isPending || updateQuestion.isPending
    || deleteQuestion.isPending || reorder.isPending;

  const nextSequence = questions.reduce((max, q) => Math.max(max, q.pmo_sequence ?? 0), 0) + 1;

  async function handleAdd() {
    const text = newText.trim();
    if (!text) {
      setNewTextError('A question needs text.');
      return;
    }
    setNewTextError(null);
    try {
      await createQuestion.mutateAsync({
        'pmo_Template@odata.bind': `/pmo_uattemplates(${templateId})`,
        pmo_questiontext: text,
        pmo_sequence: nextSequence,
        pmo_isrequired: true,
        pmo_capturesobservedvalue: true,
        pmo_allowscomment: true,
        pmo_allowsattachment: true,
      });
      setNewText('');
    }
    catch {
      // useAppMutation toasted and logged; keep the typed text so it is not lost.
    }
  }

  /** Move one question up or down by swapping sequences with its neighbour. */
  async function handleMove(question: UatTemplateQuestion, direction: -1 | 1) {
    const ordered = [...questions].sort((a, b) => (a.pmo_sequence ?? 0) - (b.pmo_sequence ?? 0));
    const index = ordered.findIndex((q) => q.pmo_uattemplatequestionid === question.pmo_uattemplatequestionid);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= ordered.length) return;

    const a = ordered[index];
    const b = ordered[target];
    try {
      await reorder.mutateAsync([
        { id: a.pmo_uattemplatequestionid, sequence: b.pmo_sequence ?? target + 1 },
        { id: b.pmo_uattemplatequestionid, sequence: a.pmo_sequence ?? index + 1 },
      ]);
    }
    catch {
      // Reported by useAppMutation. The list refetches on settle, so the visible order
      // returns to whatever actually persisted rather than a guess.
    }
  }

  function patch(question: UatTemplateQuestion, changes: Parameters<typeof updateQuestion.mutateAsync>[0]['payload']) {
    void updateQuestion.mutateAsync({ id: question.pmo_uattemplatequestionid, payload: changes })
      .catch(() => undefined);
  }

  if (isError) {
    return (
      <div className="rounded-xl border bg-muted/30 p-8 text-center">
        <p className="text-sm font-medium">Questions could not be loaded</p>
        <p className="mt-1 text-xs text-muted-foreground">
          A load failure, not an empty template — nothing has been deleted.
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading questions…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {questions.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-sm">
          <p className="font-medium">No questions yet</p>
          <p className="mt-1 text-muted-foreground">
            Add the first question below. A tester will be asked these in order.
          </p>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.section} className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{group.section}</h3>
            {group.isUngrouped && (
              // Explains the bucket rather than pretending it is a real section.
              <span className="text-xs text-muted-foreground">
                — no section recorded for these questions
              </span>
            )}
            <Badge variant="outline">{group.questions.length}</Badge>
          </div>

          <ul className="space-y-3">
            {group.questions.map((q) => (
              <li key={q.pmo_uattemplatequestionid} className="rounded-lg border p-4">
                <div className="flex items-start gap-3">
                  <GripVertical className="mt-2 h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden />

                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`q-text-${q.pmo_uattemplatequestionid}`}>
                        Question <span aria-hidden className="text-destructive">*</span>
                        <span className="sr-only">(required)</span>
                      </Label>
                      <Textarea
                        id={`q-text-${q.pmo_uattemplatequestionid}`}
                        defaultValue={q.pmo_questiontext}
                        rows={2}
                        disabled={!canEdit}
                        aria-required
                        onBlur={(e) => {
                          const next = e.target.value.trim();
                          if (!next || next === q.pmo_questiontext) return;
                          patch(q, { pmo_questiontext: next });
                        }}
                      />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor={`q-type-${q.pmo_uattemplatequestionid}`}>Answer type</Label>
                        <Select
                          disabled={!canEdit}
                          value={q.pmo_responsetype != null ? String(q.pmo_responsetype) : undefined}
                          onValueChange={(value) => patch(q, { pmo_responsetype: Number(value) })}
                        >
                          <SelectTrigger id={`q-type-${q.pmo_uattemplatequestionid}`}>
                            <SelectValue placeholder="Not set" />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(UAT_RESPONSE_TYPE).map(([name, value]) => (
                              <SelectItem key={name} value={String(value)}>
                                {UAT_RESPONSE_TYPE_LABELS[value]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor={`q-section-${q.pmo_uattemplatequestionid}`}>Section</Label>
                        <Input
                          id={`q-section-${q.pmo_uattemplatequestionid}`}
                          defaultValue={q.pmo_section ?? ''}
                          disabled={!canEdit}
                          placeholder="Leave blank to keep it ungrouped"
                          onBlur={(e) => {
                            const next = e.target.value.trim();
                            if (next === (q.pmo_section ?? '')) return;
                            patch(q, { pmo_section: next || null });
                          }}
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-4 text-sm">
                      {([
                        { field: 'pmo_isrequired', label: 'Required' },
                        { field: 'pmo_capturesobservedvalue', label: 'Captures observed value' },
                        { field: 'pmo_allowscomment', label: 'Allows comment' },
                        { field: 'pmo_allowsattachment', label: 'Allows attachment' },
                      ] as const).map(({ field, label }) => (
                        <label key={field} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            disabled={!canEdit}
                            checked={q[field] !== false}
                            onChange={(e) => patch(q, { [field]: e.target.checked })}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>

                    {q.pmo_capturesobservedvalue !== false && (
                      <div className="space-y-1.5">
                        <Label htmlFor={`q-obs-${q.pmo_uattemplatequestionid}`}>
                          Observed-value label
                        </Label>
                        <Input
                          id={`q-obs-${q.pmo_uattemplatequestionid}`}
                          defaultValue={q.pmo_observedvaluelabel ?? ''}
                          disabled={!canEdit}
                          // The seeded 13 have no label; the source plan never supplied
                          // them. The placeholder shows the fallback the run form uses
                          // rather than inventing a legacy label here.
                          placeholder={`${DEFAULT_OBSERVED_VALUE_LABEL} (used when blank)`}
                          onBlur={(e) => {
                            const next = e.target.value.trim();
                            if (next === (q.pmo_observedvaluelabel ?? '')) return;
                            patch(q, { pmo_observedvaluelabel: next || null });
                          }}
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move "${q.pmo_questiontext}" earlier`}
                      disabled={!canEdit || busy}
                      onClick={() => void handleMove(q, -1)}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move "${q.pmo_questiontext}" later`}
                      disabled={!canEdit || busy}
                      onClick={() => void handleMove(q, 1)}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete "${q.pmo_questiontext}"`}
                      disabled={!canEdit || busy}
                      onClick={() => setPendingDelete(q)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {canEdit && (
        <div className="space-y-2 rounded-lg border border-dashed p-4">
          <Label htmlFor="uat-new-question">Add a question</Label>
          <div className="flex gap-2">
            <Input
              id="uat-new-question"
              value={newText}
              placeholder="What should the tester check?"
              aria-invalid={!!newTextError}
              aria-describedby={newTextError ? 'uat-new-question-error' : undefined}
              onChange={(e) => {
                setNewText(e.target.value);
                if (newTextError) setNewTextError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void handleAdd(); }
              }}
            />
            <Button onClick={() => void handleAdd()} disabled={busy}>
              {createQuestion.isPending
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                : <Plus className="mr-1.5 h-3.5 w-3.5" />}
              Add
            </Button>
          </div>
          {newTextError && (
            <p id="uat-new-question-error" className="text-xs text-destructive">{newTextError}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Adding a question is a single row write. It appears in the next run — there is
            nothing to deploy.
          </p>
        </div>
      )}

      {/* Destructive action confirms intent, per the CRUD standard. */}
      <Dialog open={!!pendingDelete} onOpenChange={(next) => { if (!next) setPendingDelete(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this question?</DialogTitle>
            <DialogDescription>
              Runs already answered keep their own copy of the wording, so history is not
              affected. Future runs will no longer ask it.
            </DialogDescription>
          </DialogHeader>
          {pendingDelete && (
            <p className="rounded border bg-muted/40 p-3 text-sm">{pendingDelete.pmo_questiontext}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteQuestion.isPending}
              onClick={() => {
                const target = pendingDelete;
                if (!target) return;
                void deleteQuestion.mutateAsync(target.pmo_uattemplatequestionid)
                  .catch(() => undefined)
                  .finally(() => setPendingDelete(null));
              }}
            >
              {deleteQuestion.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Delete question
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
