/**
 * UatAttachmentPanel — evidence on one UAT record. Three ways in, one way through.
 *
 * Drag, browse and paste all funnel into `attachFiles`, which calls
 * `evidenceRejectionReason` once per file and then the one upload path. That is what
 * makes T031's "the same message whether it arrived by drag, browse or paste" true by
 * construction rather than by three matching string literals.
 *
 * NO CAP ON COUNT. The legacy system had five fixed image columns; there is no constant
 * here to raise later, and a test attaches six files to prove it.
 *
 * PASTE, AND WHY IT IS A WINDOW LISTENER. A tester presses PrintScreen, then Ctrl+V.
 * Requiring them to click the panel first to give it focus would lose the gesture the
 * feature exists for. The listener is on `window`, and one module-level WeakSet marks
 * each ClipboardEvent as claimed so that two mounted panels cannot both attach the same
 * screenshot — "exactly one attachment row" is an acceptance clause, and one paste
 * dispatching to two listeners is the obvious way to break it.
 *
 * WHAT THIS COMPONENT DOES NOT DO. It never launches a capture tool and never offers
 * screen recording — no getDisplayMedia, no MediaRecorder, no mediaDevices. The tester
 * captures with the operating system; the app receives what the clipboard holds. A
 * source-text test asserts those APIs are absent, because an added convenience button is
 * exactly how that boundary would erode.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Paperclip, Trash2, Upload, ExternalLink, AlertTriangle } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { ConfirmDialog } from '../../../components/common/ConfirmDialog';
import { toast } from '../../../hooks/useToast';
import {
  useUatEvidence,
  useAttachUatEvidence,
  useDetachUatEvidence,
  type UatEvidenceItem,
} from '../../../hooks/useUatAttachments';
import {
  evidenceRejectionReason,
  formatBytes,
  openUatEvidence,
  UAT_MAX_FILE_BYTES,
  type UatEvidenceParent,
} from '../lib/uatEvidence';
import { UAT_ATTACHMENT_CATEGORY, UAT_ATTACHMENT_CATEGORY_LABELS } from '../../../lib/uatOptionSets';
import type { UatAttachmentCategoryValue } from '../../../lib/uatOptionSets';

/**
 * Paste events already handled by one panel. A WeakSet so a discarded event is not
 * retained; module-level so two panels on one page cannot both claim the same paste.
 */
const claimedPastes = new WeakSet<ClipboardEvent>();

/** A pasted screenshot arrives as a nameless Blob; the panel names it. */
function nameForPastedImage(type: string): string {
  const ext = type === 'image/jpeg' ? 'jpg' : (type.split('/')[1] || 'png');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `screenshot-${stamp}.${ext}`;
}

/**
 * The image files on a clipboard event — nothing else.
 *
 * Pasting text must not attach anything, so `clipboardData.items` is filtered to image
 * kinds. A file copied in the OS file manager arrives in `files` with a real name and is
 * taken as-is; a screen capture arrives as a nameless image item and is renamed.
 */
export function imageFilesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const out: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (!file) continue;
    // A capture has no usable name ('image.png' is what Chromium invents); a real
    // dragged/copied file keeps its own.
    const named = file.name && file.name !== 'image.png'
      ? file
      : new File([file], nameForPastedImage(file.type), { type: file.type });
    out.push(named);
  }
  return out;
}

export interface UatAttachmentPanelProps {
  parent: UatEvidenceParent;
  /** Undefined while the parent record is still being created — the panel says so. */
  parentId: string | undefined;
  /** Telemetry/error context only; not a bind. */
  projectId?: string;
  /** Category for a browsed or dragged file. A pasted image is always a Screenshot. */
  defaultCategory?: UatAttachmentCategoryValue;
  heading?: string;
  /** Hide the upload controls (a closed run, a read-only viewer). Reads stay. */
  readOnly?: boolean;
}

export function UatAttachmentPanel({
  parent,
  parentId,
  projectId,
  defaultCategory = UAT_ATTACHMENT_CATEGORY.TestEvidence,
  heading = 'Evidence',
  readOnly = false,
}: UatAttachmentPanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [toDelete, setToDelete] = useState<UatEvidenceItem | null>(null);
  const [uploading, setUploading] = useState(0);

  const evidence = useUatEvidence(parent, parentId);
  const attach = useAttachUatEvidence(parent, parentId ?? '', projectId);
  const detach = useDetachUatEvidence(parent, parentId ?? '', projectId);

  /**
   * The single funnel. Rejections are reported per file and do not stop the others: six
   * files where one is oversized attaches five and says why the sixth did not.
   */
  const attachFiles = useCallback(async (files: File[], category: UatAttachmentCategoryValue) => {
    if (!parentId || readOnly || files.length === 0) return;
    const accepted: File[] = [];
    for (const file of files) {
      const reason = evidenceRejectionReason(file);
      if (reason) toast.error(reason); else accepted.push(file);
    }
    if (accepted.length === 0) return;
    setUploading((n) => n + accepted.length);
    let done = 0;
    try {
      // Sequential, not Promise.all. Each upload base64-encodes its whole body in the
      // browser and posts it as one action parameter; six of those in flight together is
      // how a tab runs out of memory on a set of screenshots.
      for (const file of accepted) {
        await attach.mutateAsync({ file, category });
        done++;
      }
      toast.success(done === 1 ? 'File attached.' : `${done} files attached.`);
    } catch {
      // useAppMutation has already toasted and logged. Nothing to add, and swallowing
      // here is what lets the remaining count settle correctly.
    } finally {
      setUploading((n) => Math.max(0, n - accepted.length));
    }
  }, [attach, parentId, readOnly]);

  // Paste: window-level so the gesture works without the panel being focused first.
  useEffect(() => {
    if (!parentId || readOnly) return;
    const onPaste = (event: ClipboardEvent) => {
      if (claimedPastes.has(event)) return;
      const files = imageFilesFromClipboard(event.clipboardData);
      if (files.length === 0) return;   // plain text paste: not our business
      claimedPastes.add(event);
      void attachFiles(files, UAT_ATTACHMENT_CATEGORY.Screenshot);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [attachFiles, parentId, readOnly]);

  const busy = uploading > 0 || attach.isPending;

  return (
    <section className="pt-4 border-t mt-4" aria-label={`${heading} attachments`}>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
          <Paperclip className="h-3.5 w-3.5" /> {heading}
          {evidence.items.length > 0 && (
            <span className="text-muted-foreground/70 normal-case tracking-normal">
              ({evidence.items.length})
            </span>
          )}
        </h4>
        {!readOnly && (
          <>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              data-testid="uat-evidence-file-input"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';   // let the same file be picked again after a fix
                void attachFiles(files, defaultCategory);
              }}
            />
            <Button
              size="sm" variant="outline" className="h-7 text-xs"
              disabled={!parentId || busy}
              onClick={() => fileInput.current?.click()}
              title={parentId ? 'Attach files to this record' : 'Save the record first'}
            >
              {busy
                ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                : <Upload className="h-3.5 w-3.5 mr-1" />}
              Attach
            </Button>
          </>
        )}
      </div>

      {!parentId && (
        <p className="text-sm text-muted-foreground">
          Save this record before attaching evidence.
        </p>
      )}

      {parentId && !readOnly && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void attachFiles(Array.from(e.dataTransfer.files ?? []), defaultCategory);
          }}
          data-testid="uat-evidence-dropzone"
          className={`mb-2 rounded-md border border-dashed px-3 py-4 text-center text-xs transition-colors ${
            dragging ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground'
          }`}
        >
          Drop files here, or press <kbd className="px-1 py-0.5 rounded border text-[10px]">Ctrl</kbd>
          {' '}+{' '}<kbd className="px-1 py-0.5 rounded border text-[10px]">V</kbd> to paste a screenshot
          you captured with your operating system. Up to {formatBytes(UAT_MAX_FILE_BYTES)} per file,
          any number of files.
        </div>
      )}

      {evidence.isError && (
        <p className="text-sm text-destructive" role="alert">
          Couldn't load this record's evidence. It may still be attached — retry rather than
          re-attaching.
        </p>
      )}

      {parentId && !evidence.isError && !evidence.isPending && evidence.items.length === 0 && (
        <p className="text-sm text-muted-foreground">No evidence attached yet.</p>
      )}

      {(evidence.truncated || evidence.linksUnavailable) && (
        <p className="text-xs text-amber-700 flex items-center gap-1.5 mb-2" role="status">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {evidence.truncated
            ? 'This record has more files than could be listed in one read — some links may be missing.'
            : 'The document library did not answer, so files cannot be opened right now.'}
        </p>
      )}

      <div className="space-y-1.5">
        {evidence.items.map((item) => (
          <div
            key={item.row.pmo_uatattachmentid}
            className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-md border border-border bg-card"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-sm text-foreground truncate">{item.row.pmo_filename}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                {UAT_ATTACHMENT_CATEGORY_LABELS[item.row.pmo_category ?? -1] ?? 'Uncategorised'}
                {item.row.pmo_filesizebytes ? ` · ${formatBytes(item.row.pmo_filesizebytes)}` : ''}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                disabled={!item.link}
                title={item.link ? 'Open in SharePoint' : 'No link available for this file yet'}
                aria-label={`Open ${item.row.pmo_filename}`}
                onClick={() => {
                  try { openUatEvidence({ itemId: item.itemId, fileName: item.row.pmo_filename, link: item.link }); }
                  catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
                }}
                className="h-7 px-2 inline-flex items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-40"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
              {!readOnly && (
                <button
                  type="button"
                  disabled={detach.isPending}
                  title="Remove" aria-label={`Remove ${item.row.pmo_filename}`}
                  onClick={() => setToDelete(item)}
                  className="h-7 px-2 inline-flex items-center rounded-md text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}

        {evidence.isPending && parentId && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-3 py-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading evidence…
          </div>
        )}
        {uploading > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-3 py-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Uploading {uploading} file{uploading === 1 ? '' : 's'}…
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!toDelete}
        title="Remove this file?"
        message={`"${toDelete?.row.pmo_filename ?? 'This file'}" will be removed from this record and deleted from the document library.`}
        confirmLabel="Remove"
        onConfirm={() => { if (toDelete) { detach.mutate(toDelete); setToDelete(null); } }}
        onCancel={() => setToDelete(null)}
        isLoading={detach.isPending}
      />
    </section>
  );
}
