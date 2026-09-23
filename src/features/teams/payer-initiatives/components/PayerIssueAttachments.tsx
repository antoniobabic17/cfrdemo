/**
 * PayerIssueAttachments — the Attachments section for a payer inquiry.
 *
 * Shows TWO sources, merged into one list:
 *   1. LEGACY File-column files (from the old model-driven app) — read/download
 *      only. Sourced from the 7 cr87a File columns via payerIssueFiles.
 *   2. APP-uploaded documents — routed through the shared sharePointClient, which
 *      honors the pmo.file_source flag: annotations bound to cr87a_payerissue
 *      (HasNotes) when 'dataverse', the AppDocuments SharePoint library when
 *      'sharepoint'. listDocuments returns ONLY the active source's files (no
 *      cross-source merge); open/delete route per-item on doc.source.
 *
 * New uploads NEVER write the legacy File columns.
 */
import { useRef, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Loader2, Download, Upload, Trash2, Paperclip, FileText } from 'lucide-react';
import { Button } from '../../../../components/ui/button';
import { ConfirmDialog } from '../../../../components/common/ConfirmDialog';
import { toast } from '../../../../hooks/useToast';
import { useEffectiveAdminRole } from '../../../../providers/ConfigurationProvider';
import {
  listDocuments, uploadDocumentAndConfirm, openDocument, deleteDocument,
  type DocumentItem,
} from '../../../../lib/sharePointClient';
import {
  legacyFilesFromRecord, openLegacyFile, type LegacyFileAttachment,
} from '../api/payerIssueFiles';
import type { PayerIssue } from '../api/payerIssues.api';
import { FileSourceBadge, LegacyFileBadge } from '../../../../components/common/FileSourceBadge';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

interface Props {
  issue: PayerIssue;
}

export function PayerIssueAttachments({ issue }: Props) {
  const id = issue.cr87a_payerissueid;
  const qc = useQueryClient();
  const adminRole = useEffectiveAdminRole();
  const isAdmin = adminRole !== 'none';
  const fileInput = useRef<HTMLInputElement>(null);
  const [busyLegacy, setBusyLegacy] = useState<string | null>(null);
  const [busyDoc, setBusyDoc] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<DocumentItem | null>(null);

  // Always show legacy File-column files regardless of the active file source.
  // These files live in Dataverse native File-type columns (cr87a_supportingdocumentation,
  // cr87a_patientdocument1..6), NOT in annotations or SharePoint. They cannot appear
  // in listDocuments() output (which reads either annotations OR the AppDocuments SP
  // library, neither of which contains File-column data), so showing them alongside
  // appDocs can never produce duplicates. The migration script
  // (migrate-payer-filecolumns-to-sharepoint.py) was not run against PROD before
  // the pmo.file_source flag was flipped to 'sharepoint', so 743+ records still
  // hold their only attachment here. Removing the guard restores visibility for
  // those records without affecting any other upload path.
  const legacyFiles: LegacyFileAttachment[] = legacyFilesFromRecord(issue as unknown as Record<string, unknown>);

  const { data: appDocs = [], isPending } = useQuery({
    queryKey: ['payerIssueDocs', id],
    queryFn: () => listDocuments({ recordType: 'PayerIssue', recordId: id }),
    staleTime: 30_000,
    retry: false,
    enabled: !!id,
  });

  const uploadMut = useMutation({
    mutationFn: (file: File) =>
      uploadDocumentAndConfirm(file, { recordType: 'PayerIssue', recordId: id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payerIssueDocs', id] });
      toast.success('File uploaded.');
    },
    onError: (err) => toast.error(`Upload failed: ${err instanceof Error ? err.message : String(err)}`),
  });

  const deleteMut = useMutation({
    mutationFn: (doc: DocumentItem) => deleteDocument(doc),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payerIssueDocs', id] });
      toast.success('File deleted.');
    },
    onError: (err) => toast.error(`Delete failed: ${err instanceof Error ? err.message : String(err)}`),
  });

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB; limit is 5 MB.`);
      return;
    }
    uploadMut.mutate(file);
  }

  async function handleLegacyDownload(f: LegacyFileAttachment) {
    setBusyLegacy(f.column);
    try {
      await openLegacyFile(id, f.column, f.fileName);
    } catch (err) {
      toast.error(`Couldn't download: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyLegacy(null);
    }
  }

  async function handleDocDownload(doc: DocumentItem) {
    setBusyDoc(doc.annotationId);
    try {
      await openDocument(doc);
    } catch (err) {
      toast.error(`Couldn't open: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyDoc(null);
    }
  }

  const nothing = legacyFiles.length === 0 && appDocs.length === 0 && !isPending;

  return (
    <section className="pt-4 border-t mt-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
          <Paperclip className="h-3.5 w-3.5" /> Attachments
        </h4>
        <>
          <input ref={fileInput} type="file" className="hidden" onChange={handlePick} />
          <Button size="sm" variant="outline" className="h-7 text-xs"
            onClick={() => fileInput.current?.click()} disabled={uploadMut.isPending}
            title="Upload a file to this payer inquiry">
            {uploadMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
            Upload
          </Button>
        </>
      </div>

      {nothing && <p className="text-sm text-muted-foreground">No attachments.</p>}

      <div className="space-y-1.5">
        {/* Legacy File-column files — download only */}
        {legacyFiles.map((f) => (
          <div key={f.column} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-md border border-border bg-card">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-sm text-foreground truncate">{f.fileName}</span>
              <LegacyFileBadge />
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">{f.slotLabel}</span>
            </div>
            <button type="button" onClick={() => handleLegacyDownload(f)} disabled={busyLegacy === f.column}
              title="Download" className="h-7 px-2 inline-flex items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60">
              {busyLegacy === f.column ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            </button>
          </div>
        ))}

        {/* App-uploaded docs (annotation or SharePoint) — download + delete */}
        {appDocs.map((doc) => (
          <div key={doc.annotationId} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-md border border-border bg-card">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-sm text-foreground truncate">{doc.fileName ?? '(unnamed)'}</span>
              <FileSourceBadge source={doc.source} />
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button type="button" onClick={() => handleDocDownload(doc)} disabled={busyDoc === doc.annotationId}
                title="Download" className="h-7 px-2 inline-flex items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60">
                {busyDoc === doc.annotationId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              </button>
              {isAdmin && (
                <button type="button" onClick={() => setToDelete(doc)} disabled={deleteMut.isPending}
                  title="Delete" className="h-7 px-2 inline-flex items-center rounded-md text-rose-600 hover:text-rose-700 hover:bg-rose-50">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}

        {isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-3 py-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading attachments…
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete this file?"
        message={`"${toDelete?.fileName ?? 'This file'}" will be permanently removed from this payer inquiry.`}
        confirmLabel="Delete"
        onConfirm={() => { if (toDelete) { deleteMut.mutate(toDelete); setToDelete(null); } }}
        onCancel={() => setToDelete(null)}
        isLoading={deleteMut.isPending}
      />
    </section>
  );
}
