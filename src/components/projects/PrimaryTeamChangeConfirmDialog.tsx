/**
 * Confirmation dialog for a Primary Team change on a project (2026-07-22).
 *
 * Fires from EditProjectDialog when the operator saves a change to the
 * Governance-tab Primary Team dropdown. Explains the cascade side-effects
 * before applyPrimaryTeamChange fires, so the operator can back out.
 *
 * Kept separate from the generic ConfirmDialog because the body is a
 * bulleted impact list, not a single message string.
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  oldTeamName?: string;
  newTeamName?: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  isPending: boolean;
}

export function PrimaryTeamChangeConfirmDialog({
  open,
  oldTeamName,
  newTeamName,
  onCancel,
  onConfirm,
  isPending,
}: Props) {
  const oldName = oldTeamName?.trim() || 'the current team';
  const newName = newTeamName?.trim() || 'the new team';

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen && !isPending) onCancel(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Change primary team?</DialogTitle>
          <DialogDescription>
            Changing the primary team on this project has a few side effects.
            Review before you save.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2.5 text-sm text-foreground py-1 list-disc pl-5">
          <li>
            <span className="font-semibold">{oldName}</span> will be demoted to a{' '}
            <span className="font-semibold">Contributing</span> team on this
            project. Its members remain assignable so nothing they already own
            disappears.
          </li>
          <li>
            <span className="font-semibold">{newName}</span> will become the
            new <span className="font-semibold">Primary</span> team.
          </li>
          <li>
            Members of <span className="font-semibold">{newName}</span> will
            get Read / Write / Append / AppendTo access to this project.
          </li>
          <li>
            Task assignee dropdowns, Decision Owner picker, and other
            project-side people pickers will refresh to include the new
            team's members.
          </li>
          <li>
            Team-feature panels bound to the primary team (Payer Initiative
            SAE field, BI Coding form) may appear or disappear depending on
            which team you're moving to.
          </li>
        </ul>

        <DialogFooter>
          <Button variant="secondary" disabled={isPending} onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => void onConfirm()} disabled={isPending} aria-busy={isPending}>
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Saving…
              </>
            ) : (
              'Confirm and save'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
