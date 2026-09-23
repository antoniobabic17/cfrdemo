/**
 * One template: its header fields, its questions, and clone-to-new-version.
 *
 * CLONE LEAVES THE ORIGINAL UNTOUCHED. That is the acceptance clause, and it is why
 * clone exists at all: a template already used by historical runs should be evolved by
 * copying, not by editing in place. Editing in place is still allowed and still safe —
 * answers snapshot their own question text — but a clone gives a clean version boundary
 * for a template whose meaning is changing rather than being corrected.
 *
 * The clone runs as ONE mutation (useCloneUatTemplate) rather than a create followed by
 * N calls to the per-template question hook — that hook keys its cache off the template
 * id it was constructed with, so driving a clone through it would invalidate the source's
 * question list and never the copy's. The new template is created first, so an interrupted
 * clone leaves an obviously-incomplete new version rather than damaging the original.
 *
 * Header fields save on blur. There is no explicit Save button here because there is no
 * multi-field transaction to commit — each field is its own row update, and a failed one
 * is reported by useAppMutation without discarding the others.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, Loader2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { Badge } from '../../../components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import {
  useUatTemplate,
  useUpdateUatTemplate,
  useUatTemplateQuestions,
  useCloneUatTemplate,
} from '../../../hooks/useUatTemplates';
import { TemplateQuestionEditor } from '../components/TemplateQuestionEditor';

export function TemplateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: template, isLoading, isError, refetch } = useUatTemplate(id);
  const { data: questions = [] } = useUatTemplateQuestions(id);
  const updateTemplate = useUpdateUatTemplate();
  const cloneTemplate = useCloneUatTemplate();
  const [cloneOpen, setCloneOpen] = useState(false);

  if (isError) {
    return (
      <div className="p-6">
        <div className="rounded-xl border bg-muted/30 p-12 text-center">
          <p className="text-sm font-medium">This template could not be loaded</p>
          <p className="mt-1 text-xs text-muted-foreground">
            A load failure, not a deleted template.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void refetch()}>Try again</Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('/uat/templates')}>
              Back to templates
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading || !template || !id) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading template…
      </div>
    );
  }

  async function handleClone() {
    if (!template) return;
    const nextVersion = (template.pmo_version ?? 1) + 1;
    try {
      const copy = await cloneTemplate.mutateAsync({
        template: {
          pmo_name: `${template.pmo_name} (v${nextVersion})`,
          pmo_description: template.pmo_description,
          pmo_version: nextVersion,
          pmo_isactive: true,
          pmo_defaultestimatedminutes: template.pmo_defaultestimatedminutes,
        },
        // Every per-question setting travels with the copy. Missing one would mean the
        // clone silently asks a different question than the original.
        questions: [...questions]
          .sort((a, b) => (a.pmo_sequence ?? 0) - (b.pmo_sequence ?? 0))
          .map((q) => ({
            pmo_questiontext: q.pmo_questiontext,
            pmo_sequence: q.pmo_sequence,
            pmo_helptext: q.pmo_helptext,
            pmo_expectedresult: q.pmo_expectedresult,
            pmo_responsetype: q.pmo_responsetype,
            pmo_isrequired: q.pmo_isrequired,
            pmo_capturesobservedvalue: q.pmo_capturesobservedvalue,
            pmo_observedvaluelabel: q.pmo_observedvaluelabel,
            pmo_allowscomment: q.pmo_allowscomment,
            pmo_allowsattachment: q.pmo_allowsattachment,
            pmo_section: q.pmo_section,
          })),
      });

      setCloneOpen(false);
      navigate(`/uat/templates/${copy.pmo_uattemplateid}`);
    }
    catch {
      // useAppMutation reported it. The original is untouched either way — the clone
      // only ever writes to the new template.
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/uat/templates')}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Templates
        </Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{template.pmo_name}</h1>
            <Badge variant="outline">v{template.pmo_version ?? 1}</Badge>
            {template.pmo_isactive === false && <Badge variant="outline">Inactive</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {questions.length} question{questions.length === 1 ? '' : 's'}. Changes apply to
            future runs; answered runs keep the wording they were answered against.
          </p>
        </div>
        <Button variant="outline" onClick={() => setCloneOpen(true)}>
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Clone to new version
        </Button>
      </div>

      <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="tpl-name">
            Name <span aria-hidden className="text-destructive">*</span>
            <span className="sr-only">(required)</span>
          </Label>
          <Input
            id="tpl-name"
            defaultValue={template.pmo_name}
            aria-required
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (!next || next === template.pmo_name) return;
              void updateTemplate.mutateAsync({ id, payload: { pmo_name: next } })
                .catch(() => undefined);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tpl-minutes">Default estimated minutes</Label>
          <Input
            id="tpl-minutes"
            type="number"
            min={0}
            defaultValue={template.pmo_defaultestimatedminutes ?? ''}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const next = raw === '' ? null : Number(raw);
              if (next !== null && Number.isNaN(next)) return;
              if (next === (template.pmo_defaultestimatedminutes ?? null)) return;
              void updateTemplate.mutateAsync({ id, payload: { pmo_defaultestimatedminutes: next } })
                .catch(() => undefined);
            }}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="tpl-description">Description</Label>
          <Textarea
            id="tpl-description"
            defaultValue={template.pmo_description ?? ''}
            rows={2}
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next === (template.pmo_description ?? '')) return;
              void updateTemplate.mutateAsync({ id, payload: { pmo_description: next || null } })
                .catch(() => undefined);
            }}
          />
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            className="h-4 w-4"
            defaultChecked={template.pmo_isactive !== false}
            onChange={(e) => {
              void updateTemplate.mutateAsync({ id, payload: { pmo_isactive: e.target.checked } })
                .catch(() => undefined);
            }}
          />
          <span>Active — offered when creating test cases</span>
        </label>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Questions</h2>
        <TemplateQuestionEditor templateId={id} canEdit />
      </div>

      <Dialog open={cloneOpen} onOpenChange={(next) => { if (!cloneTemplate.isPending) setCloneOpen(next); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clone to a new version?</DialogTitle>
            <DialogDescription>
              Creates version {(template.pmo_version ?? 1) + 1} with a copy of all{' '}
              {questions.length} question{questions.length === 1 ? '' : 's'}.{' '}
              <strong>This template is not changed.</strong> Test cases already using it keep
              using it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloneOpen(false)} disabled={cloneTemplate.isPending}>
              Cancel
            </Button>
            <Button onClick={() => void handleClone()} disabled={cloneTemplate.isPending}>
              {cloneTemplate.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Create new version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TemplateDetailPage;
