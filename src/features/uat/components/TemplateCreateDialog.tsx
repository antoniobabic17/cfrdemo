/**
 * Create a template.
 *
 * FORM BASELINE, per the component standards: the required field is labelled and
 * marked, validation runs client-side before the write AND the server's refusal is
 * surfaced, save and cancel are predictable, and failure is visible. The success and
 * failure feedback comes from useAppMutation — it owns the toast and the telemetry row,
 * and this component deliberately does not add its own (see finding 34: sibling hooks
 * that toast in their own onError double-toast).
 *
 * Client validation here is a courtesy, not the guarantee. pmo_name is
 * ApplicationRequired in Dataverse, so the platform refuses an empty name regardless.
 * Both layers exist because the client one gives an instant, focused message and the
 * server one is what actually holds.
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
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
import { useCreateUatTemplate } from '../../../hooks/useUatTemplates';

export interface TemplateCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new template's id so the caller can navigate to it. */
  onCreated?: (id: string) => void;
}

const NAME_MAX = 200;

export function TemplateCreateDialog({ open, onOpenChange, onCreated }: TemplateCreateDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const createTemplate = useCreateUatTemplate();

  function reset() {
    setName('');
    setDescription('');
    setNameError(null);
  }

  /**
   * Cancel discards, and has to say so through this function rather than through the
   * onOpenChange prop directly.
   *
   * A controlled Radix Dialog fires its own onOpenChange only when Radix initiates the
   * close — Escape, the overlay, the built-in close button. Wiring Cancel straight to the
   * prop closes it through the parent instead, so the reset in the Dialog's own handler
   * never runs and the next open carries the abandoned text. Measured 2026-08-31: it did.
   * dialogCancelDiscards.test.tsx asserts it on both UAT create dialogs.
   */
  function cancel() {
    reset();
    onOpenChange(false);
  }

  function validate(): boolean {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('A template needs a name.');
      return false;
    }
    if (trimmed.length > NAME_MAX) {
      setNameError(`Keep the name to ${NAME_MAX} characters or fewer.`);
      return false;
    }
    setNameError(null);
    return true;
  }

  async function handleSave() {
    if (!validate()) return;
    try {
      const created = await createTemplate.mutateAsync({
        pmo_name: name.trim(),
        pmo_description: description.trim() || null,
        pmo_version: 1,
        pmo_isactive: true,
      });
      reset();
      onOpenChange(false);
      onCreated?.(created.pmo_uattemplateid);
    }
    catch {
      // useAppMutation has already toasted and logged. Staying open with the typed
      // values intact is the point: closing would discard what the user wrote.
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Cancel discards, deliberately and predictably. There is no partial save.
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New template</DialogTitle>
          <DialogDescription>
            A template holds the ordered questions a tester answers. You can add and
            reorder questions after creating it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="uat-template-name">
              Name <span aria-hidden className="text-destructive">*</span>
              <span className="sr-only">(required)</span>
            </Label>
            <Input
              id="uat-template-name"
              value={name}
              maxLength={NAME_MAX}
              aria-required
              aria-invalid={!!nameError}
              aria-describedby={nameError ? 'uat-template-name-error' : undefined}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
              placeholder="e.g. Epic Claim Validation"
            />
            {nameError && (
              <p id="uat-template-name-error" className="text-xs text-destructive">
                {nameError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="uat-template-description">Description</Label>
            <Textarea
              id="uat-template-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this template is for, and when to use it."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={cancel} disabled={createTemplate.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={createTemplate.isPending}>
            {createTemplate.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Create template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
