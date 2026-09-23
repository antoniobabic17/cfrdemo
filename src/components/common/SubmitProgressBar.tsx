/**
 * SubmitProgressBar — top-of-app indicator for an in-flight task Submit.
 *
 * Renders the entire batch in one line so the user sees EVERYTHING that's
 * being saved, not just whichever step happens to be running right now.
 * Format:
 *
 *    [spinner] Saving "Task name" — Title, Due, Hours done, +label P0,
 *              +assignee Antonio, ✓ checklist "Foo"  (3/6)
 *
 * Field steps render their field labels. Relationship steps (label /
 * assignee / checklist add+remove+toggle) render the per-step label that
 * the panel built (e.g. "Adding label P0"). Both flow through here so the
 * bar reflects the full Submit, including relationship changes.
 */
import { Loader2 } from 'lucide-react';
import { useSubmitProgress } from '../../lib/submitProgressStore';
import type { SubmitStep } from '../../lib/submitProgressStore';

const FIELD_LABELS: Record<string, string> = {
  subject: 'Title',
  description: 'Notes',
  priority: 'Priority',
  scheduledStart: 'Start',
  scheduledEnd: 'Due',
  duration: 'Duration',
  effort: 'Effort',
  effortCompleted: 'Hours Done',
  isMilestone: 'Milestone',
  bucketId: 'Bucket',
  progress: 'Progress',
};

/**
 * Bucket the panel's per-step labels into one of three category names.
 * The bar shows broad categories ("Label", "Assigned Users", "Checklist")
 * rather than per-item details — there's no need to expose individual
 * label / person / checklist names in the top-of-screen indicator.
 *
 * Examples (all collapse to the same right-hand side string):
 *   "Adding label P0"           → "Label"
 *   "Removing label Backend"    → "Label"
 *   "Renaming label to Foo"     → "Label"
 *   "Adding Antonio Lima"       → "Assigned Users"
 *   "Removing Antonio Lima"     → "Assigned Users"
 *   "Adding checklist item X"   → "Checklist"
 *   "Removing checklist item X" → "Checklist"
 *   "Checking 'X'"              → "Checklist"
 *   "Unchecking 'X'"            → "Checklist"
 *
 * Identical category names produced by multiple steps are deduplicated by
 * summarizeBatch() so the bar reads "Label, Assigned Users, Checklist"
 * even when several items in each category are queued.
 */
function compactStepLabel(raw: string): string | null {
  if (
    raw.startsWith('Adding label ') ||
    raw.startsWith('Removing label ') ||
    raw.startsWith('Renaming label to ')
  ) {
    return 'Label';
  }
  if (
    raw.startsWith('Adding checklist item ') ||
    raw.startsWith('Removing checklist item ') ||
    raw.startsWith('Checking ') ||
    raw.startsWith('Unchecking ')
  ) {
    return 'Checklist';
  }
  // Assignee adds / removes — the panel writes "Adding <Name>" or
  // "Removing <Name>" with no prefix noun.
  if (raw.startsWith('Adding ') || raw.startsWith('Removing ')) {
    return 'Assigned Users';
  }
  // Unknown step shape — drop from the bar rather than show raw text.
  return null;
}

/**
 * Build the comma-separated batch summary.
 *
 * The first step in a panel Submit is the field step — we render its
 * `fields[]` as friendly labels. Every other step has empty fields[] but
 * a meaningful `label` we collapse to a category above. Categories are
 * deduplicated so a Submit that adds 3 labels and removes 1 still reads
 * "…, Label" once instead of "…, Label, Label, Label, Label".
 */
function summarizeBatch(steps: readonly SubmitStep[]): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  const push = (token: string) => {
    if (!token || seen.has(token)) return;
    seen.add(token);
    parts.push(token);
  };
  for (const step of steps) {
    if (step.fields.length > 0) {
      for (const f of step.fields) push(FIELD_LABELS[f] ?? f);
    } else if (step.label) {
      const tok = compactStepLabel(step.label);
      if (tok) push(tok);
    }
  }
  return parts.join(', ');
}

export function SubmitProgressBar() {
  const { active } = useSubmitProgress();

  if (!active) return null;
  if (active.status === 'done') return null;

  const totalSteps = active.steps.length;
  const showCounter = totalSteps > 1;
  const summary = summarizeBatch(active.steps);

  if (active.status === 'failed') {
    // Failure UX is owned by StagingFailureWatcher (friendly toast) +
    // Admin > Error Log (raw blob). Rendering the raw PSS error text
    // here as a persistent header banner next to "Good evening" is
    // hostile UX; the toast is the single operator-facing surface.
    return null;
  }

  // Running — show the full batch in one line so the user sees EVERY change
  // being saved (fields + relationships), with a small N/M counter to show
  // how far along the per-step pipeline is.
  return (
    <div
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-[11px] text-blue-900 max-w-[40rem]"
      title={summary}
    >
      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-blue-600" />
      <span className="font-semibold shrink-0">Saving</span>
      <span className="font-medium shrink-0 max-w-[10rem] truncate" title={active.taskSubject}>
        {active.taskSubject}
      </span>
      <span className="opacity-70 shrink-0">—</span>
      <span className="truncate flex-1 min-w-0">{summary}</span>
      {showCounter && (
        <span className="shrink-0 opacity-70 tabular-nums ml-1">
          ({active.currentIndex + 1}/{totalSteps})
        </span>
      )}
    </div>
  );
}
