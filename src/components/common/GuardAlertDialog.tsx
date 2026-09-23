/**
 * GuardAlertDialog — single-button blocking alert for rule violations.
 *
 * Unlike ConfirmDialog (two buttons: Confirm + Cancel), this shows exactly
 * one "OK, Got It" button. Used for the New Resource Model task-completion
 * guard (effort not set / assignee hours don't match), where the user must
 * acknowledge the problem before they can continue — there is no "proceed
 * anyway" option.
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
import { AlertTriangle } from 'lucide-react';

interface GuardAlertDialogProps {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
}

export function GuardAlertDialog({ open, title, message, onClose }: GuardAlertDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            {title}
          </DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose}>OK, Got It</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
