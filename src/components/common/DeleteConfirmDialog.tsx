import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

export interface DeleteChildSummary {
  /** User-facing label for the child kind, e.g. "tasks", "status reports". */
  label: string;
  /** How many of this kind will be deactivated. */
  count: number;
}

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Heading shown in the dialog, e.g. "Delete project" or "Delete request". */
  title: string;
  /** The record's name. The user must type this exactly to enable Delete. */
  recordName: string;
  /** Optional list of child counts shown before confirmation. */
  childSummary?: DeleteChildSummary[];
  /** Set true while childSummary is being loaded. */
  childSummaryLoading?: boolean;
  /** Returns a promise that resolves when the deletion cascade has finished. */
  onConfirm: () => Promise<void>;
  /** Optional extra warning text shown below the counts. */
  extraWarning?: string;
  /**
   * Whether the user must type `recordName` to enable Delete.
   *
   * Defaults to TRUE so every existing caller (project / program / intake
   * request) keeps its type-to-confirm friction unchanged. Pass `false` for
   * lighter records -- deleting a task is routine, and retyping its subject
   * every time is friction out of proportion to the risk. The record name and
   * child counts are still shown either way.
   */
  requireTypedName?: boolean;
}

/**
 * Type-name-to-confirm destructive action dialog.
 *
 * The Delete button is disabled until the user types `recordName` exactly
 * (case-sensitive) into the confirmation field. While `onConfirm` is in
 * flight the button shows a spinner and both buttons are disabled.
 */
export function DeleteConfirmDialog({
  open, onOpenChange, title, recordName, childSummary, childSummaryLoading,
  onConfirm, extraWarning, requireTypedName = true,
}: DeleteConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state whenever the dialog reopens. Intentional sync setState in
  // effect — the alternative (key-on-parent remount) would push concerns
  // into every call site, and the pattern matches GlobalAnnouncementSection.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTyped('');
      setSubmitting(false);
      setError(null);
    }
  }, [open]);

  // When the typed-name gate is off, Delete is enabled immediately.
  const matches = !requireTypedName || typed === recordName;

  async function handleConfirm() {
    if (!matches || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitting) onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-700">
            <AlertTriangle className="h-5 w-5" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p>
            This will permanently delete{' '}
            <span className="font-semibold text-foreground">{recordName}</span>
            {childSummary && childSummary.length > 0 ? ' and the following related records:' : '.'}
          </p>

          {childSummaryLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Counting related records…
            </div>
          )}

          {!childSummaryLoading && childSummary && childSummary.length > 0 && (
            <ul className="text-xs text-muted-foreground space-y-0.5 pl-4 list-disc">
              {childSummary.map((c) => (
                <li key={c.label}>
                  <span className="font-mono text-foreground">{c.count}</span> {c.label}
                </li>
              ))}
            </ul>
          )}

          {extraWarning && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              {extraWarning}
            </p>
          )}

          {requireTypedName && (
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground">
                Type <span className="font-mono text-foreground">{recordName}</span> to confirm
              </label>
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={recordName}
                disabled={submitting}
                autoFocus
              />
            </div>
          )}

          {error && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!matches || submitting}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
