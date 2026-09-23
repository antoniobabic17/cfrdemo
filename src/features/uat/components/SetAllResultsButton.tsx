/**
 * Apply one outcome to every question the tester has not answered yet.
 *
 * THE LEGACY EQUIVALENT WAS AN ACTIVATED BUSINESS RULE that fanned one field into fourteen —
 * and it is one of the three places the thirteen questions were enumerated, so adding a
 * fourteenth question meant editing a business rule as well as the schema and the form. This
 * does the same job in **local form state**, before anything is written: there is no Dataverse
 * business rule, no server-side copy step, and no per-question round trip. The question count
 * is whatever the template says today, so it never needs to be enumerated anywhere.
 *
 * IT ONLY TOUCHES UNANSWERED QUESTIONS, which is the whole safety property. A tester marks the
 * two questions that failed, then bulk-passes the rest; overwriting deliberate answers would
 * silently destroy the findings the run exists to record, and the destruction would be
 * invisible — every question would read Pass and look complete. So this component never
 * receives an answered question, and the caller's patch is asserted to leave them alone.
 *
 * NOTHING IS WRITTEN HERE. The component takes a callback and calls it. Keeping the write out
 * of it is what makes "no server-side copy step" checkable rather than asserted, and a
 * source-text test holds it: this file contains no mutation hook.
 */
import { useState } from 'react';
import { ListChecks } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { UAT_OUTCOME_LABELS } from '../../../lib/uatOptionSets';
import { OUTCOME_OPTIONS } from './runAnswerFields';

export interface SetAllResultsButtonProps {
  /**
   * How many questions are still unanswered. Drives the label and disables the control, so a
   * tester is never offered an action that would do nothing.
   */
  unansweredCount: number;
  /** Called with the chosen outcome. The caller patches its own form state. */
  onApply: (outcome: number) => void;
  disabled?: boolean;
}

export function SetAllResultsButton({ unansweredCount, onApply, disabled }: SetAllResultsButtonProps) {
  const [outcome, setOutcome] = useState<number | null>(null);
  const nothingToDo = unansweredCount === 0;

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/20 p-3">
      <ListChecks className="mb-2 h-4 w-4 text-muted-foreground" aria-hidden />
      <div className="space-y-1.5">
        <label className="text-xs font-medium" htmlFor="uat-set-all-outcome">
          Set the remaining answers
        </label>
        <Select
          value={outcome == null ? '' : String(outcome)}
          disabled={disabled || nothingToDo}
          onValueChange={(v) => setOutcome(Number(v))}
        >
          <SelectTrigger id="uat-set-all-outcome" className="w-[180px]">
            <SelectValue placeholder="Choose an outcome" />
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

      <Button
        variant="outline"
        size="sm"
        disabled={disabled || nothingToDo || outcome == null}
        onClick={() => { if (outcome != null) onApply(outcome); }}
      >
        {nothingToDo
          ? 'Every question answered'
          : `Apply to ${unansweredCount} unanswered`}
      </Button>

      {/* Said plainly, because the legacy version did the opposite and did it server-side. */}
      <p className="w-full text-xs text-muted-foreground">
        Answers you have already given are left alone. Nothing is saved until you complete the
        run.
      </p>
    </div>
  );
}
