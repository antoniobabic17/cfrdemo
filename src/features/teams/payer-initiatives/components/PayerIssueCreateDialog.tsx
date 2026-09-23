/**
 * PayerIssueCreateDialog — minimal create form for cr87a_payerissue.
 *
 * Mirrors HpiCreateDialog's shape but keeps the field set tight: name,
 * short description, detailed issue. Status / type / payer lookups can be
 * filled in by the Nexus Revenue Cycle Manager source app once the row
 * exists; this dialog exists so Payer Initiatives team members can stub
 * a record from inside CFR PMO without context-switching to the source.
 */
import { useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Textarea } from '../../../../components/ui/textarea';
import { toast } from '../../../../hooks/useToast';
import { useCreatePayerIssue, useSetPayerIssueProject } from '../hooks/usePayerIssues';
import { HpiRelateProjectPicker } from './HpiRelateProjectPicker';
import { SearchableSelect } from '../../../../components/common/SearchableSelect';
import { useActivePayerInitiativesAnalysts, resolveAnalystLabel } from '../hooks/usePayerInitiativesAnalysts';
import { uploadDocumentAndConfirm } from '../../../../lib/sharePointClient';
import { Paperclip, X } from 'lucide-react';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new payer issue id after a successful create. */
  onCreated?: (id: string) => void;
}

export function PayerIssueCreateDialog({ open, onOpenChange, onCreated }: Props) {
  const create = useCreatePayerIssue();
  const setProject = useSetPayerIssueProject();
  const [name, setName] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [detailedIssue, setDetailedIssue] = useState('');
  const [projectIdToAttach, setProjectIdToAttach] = useState('');
  const [analystId, setAnalystId] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { data: analystOptions = [], isLoading: analystsLoading } = useActivePayerInitiativesAnalysts();
  const saving = create.isPending || setProject.isPending || uploadingFiles;

  function reset() {
    setName('');
    setShortDescription('');
    setDetailedIssue('');
    setProjectIdToAttach('');
    setAnalystId('');
    setPendingFiles([]);
  }

  function handlePickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    const tooBig = picked.filter((f) => f.size > MAX_UPLOAD_BYTES);
    if (tooBig.length) {
      toast.error(`${tooBig.length} file(s) exceed the 5 MB limit and were skipped.`);
    }
    const ok = picked.filter((f) => f.size <= MAX_UPLOAD_BYTES);
    if (ok.length) setPendingFiles((prev) => [...prev, ...ok]);
  }

  function removePendingFile(idx: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Name is required.');
      return;
    }
    try {
      const row = await create.mutateAsync({
        cr87a_name: trimmed,
        cr87a_shortdescription: shortDescription.trim() || undefined,
        cr87a_detailedissue: detailedIssue.trim() || undefined,
        analystSystemUserId: analystId || undefined,
      });
      if (projectIdToAttach) {
        try {
          await setProject.mutateAsync({ payerIssueId: row.cr87a_payerissueid, projectId: projectIdToAttach });
        } catch (linkErr) {
          // Row is created; surface the link failure but don't block.
          toast.error(`Created, but couldn't link project: ${linkErr instanceof Error ? linkErr.message : String(linkErr)}`);
        }
      }
      // Attachments can only bind to a saved record, so upload AFTER create,
      // to the new row's id. Non-blocking per-file (mirrors the project link).
      if (pendingFiles.length) {
        setUploadingFiles(true);
        let failed = 0;
        for (const file of pendingFiles) {
          try {
            await uploadDocumentAndConfirm(file, { recordType: 'PayerIssue', recordId: row.cr87a_payerissueid });
          } catch (upErr) {
            failed += 1;
            console.warn('[PayerIssueCreate] attachment upload failed', file.name, upErr);
          }
        }
        setUploadingFiles(false);
        if (failed) toast.error(`Created, but ${failed} attachment(s) failed to upload.`);
      }
      toast.success(`Payer inquiry "${trimmed}" created.`);
      reset();
      onOpenChange(false);
      onCreated?.(row.cr87a_payerissueid);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Couldn’t create: ${msg}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Payer Inquiry</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Name<span className="text-destructive ml-0.5">*</span>
            </label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aetna prior auth process drift" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Short Description
            </label>
            <Input
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              placeholder="One-line summary"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Detailed Issue
            </label>
            <Textarea
              rows={4}
              value={detailedIssue}
              onChange={(e) => setDetailedIssue(e.target.value)}
              placeholder="What's going on, what's the impact, what changed?"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Analyst
            </label>
            <SearchableSelect
              value={analystId}
              onChange={(v) => setAnalystId(v)}
              options={analystOptions}
              resolveLabel={resolveAnalystLabel}
              placeholder={analystsLoading ? 'Loading team…' : 'Select an analyst…'}
              disabled={analystsLoading}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Attach a Payer Initiatives project (optional)
            </label>
            <HpiRelateProjectPicker
              value={projectIdToAttach}
              onChange={setProjectIdToAttach}
              placeholder="Select a project…"
            />
            <p className="text-[10px] text-muted-foreground">Links via pmo_PayerInitiatives_Project on save. Leave blank to skip.</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Attachments (optional)
            </label>
            <input ref={fileInput} type="file" multiple className="hidden" onChange={handlePickFiles} />
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs w-full"
              onClick={() => fileInput.current?.click()} disabled={saving}>
              <Paperclip className="h-3.5 w-3.5 mr-1" /> Add file(s)
            </Button>
            {pendingFiles.length > 0 && (
              <ul className="mt-1 space-y-1">
                {pendingFiles.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 px-2 py-1 rounded border border-border bg-card text-xs">
                    <span className="truncate">{f.name}</span>
                    <button type="button" onClick={() => removePendingFile(i)} disabled={saving}
                      title="Remove" className="text-muted-foreground hover:text-rose-600 shrink-0">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[10px] text-muted-foreground">Uploaded to the inquiry after it's created. 5 MB per file.</p>
          </div>
          <p className="text-[11px] text-muted-foreground italic">
            Status, type, payer, and other catalog fields are filled in via Nexus Revenue Cycle Manager once the row exists.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={saving || !name.trim()}>
            {uploadingFiles ? 'Uploading…' : saving ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
