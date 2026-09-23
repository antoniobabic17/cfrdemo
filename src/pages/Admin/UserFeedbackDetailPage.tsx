import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { Button } from '../../components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import { getUserFeedback, updateUserFeedback } from '../../api/userFeedback.api';
import { emitFeedbackAssigned, emitFeedbackResolved, emitFeedbackOnHold } from '../../lib/notify';
import { useCurrentUserId } from '../../hooks/useCurrentUserId';
import { FEEDBACK_STATUS, FEEDBACK_PRIORITY, FEEDBACK_TYPE } from '../../lib/constants';
import { toast } from '../../hooks/useToast';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { useUserSearch } from '../../hooks/useIntakeLookups';
import { listDocuments, uploadDocumentAndConfirm, openDocument, type DocumentItem } from '../../lib/sharePointClient';
import { ImagePlus, Paperclip } from 'lucide-react';
import { FileSourceBadge } from '../../components/common/FileSourceBadge';
import { useRef } from 'react';
import { markFeedbackSaving, clearFeedbackSaving } from '../../lib/feedbackSaveStore';
import { renderRichText } from '../../components/common/RichTextEditor';
import { NotesSection } from '../../components/projects/NotesSection';
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { Textarea } from '../../components/ui/textarea';
import { useCreateNote } from '../../hooks/useProjectNotes';
import { fmtDateOnly } from '../../lib/dateOnly';

const STATUS_OPTIONS = [
  // Draft is author-owned, not an admin triage state, but it must be listed so
  // an admin opening a draft sees the correct current value rather than a blank.
  { value: FEEDBACK_STATUS.Draft, label: 'Draft' },
  { value: FEEDBACK_STATUS.New, label: 'New' },
  { value: FEEDBACK_STATUS.InReview, label: 'In Review' },
  { value: FEEDBACK_STATUS.Accepted, label: 'Accepted' },
  { value: FEEDBACK_STATUS.OnHold, label: 'On Hold' },
  { value: FEEDBACK_STATUS.Resolved, label: 'Resolved' },
];

// Sentinel value for "no priority set" so the Select can represent the
// unset state while still being a controlled component.
const PRIORITY_UNSET = '__unset__';
const PRIORITY_OPTIONS = [
  { value: PRIORITY_UNSET, label: 'Unset' },
  { value: String(FEEDBACK_PRIORITY.Critical), label: 'Critical' },
  { value: String(FEEDBACK_PRIORITY.High), label: 'High' },
  { value: String(FEEDBACK_PRIORITY.Medium), label: 'Medium' },
  { value: String(FEEDBACK_PRIORITY.Low), label: 'Low' },
];

function FieldBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <div className="rounded-md border bg-muted/30 p-4">
        {children}
      </div>
    </div>
  );
}

export function UserFeedbackDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const currentUserId = useCurrentUserId();
  const location = useLocation();
  // Notifications route here with { from: 'intake' } so Back returns to the
  // intake queue rather than the admin feedback list.
  const cameFromIntake = (location.state as { from?: string } | null)?.from === 'intake';
  const backTarget = cameFromIntake ? '/intake' : '/admin/user-feedback';

  const { data: item, isLoading, error } = useQuery({
    queryKey: ['userFeedback', id],
    queryFn: () => getUserFeedback(id!),
    enabled: !!id,
  });

  const [status, setStatus] = useState<number>(FEEDBACK_STATUS.New);
  const [priority, setPriority] = useState<number | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  // Track an explicit "user touched the picker" flag so we always send the
  // ownerid bind on save, even when the new id happens to equal the row's
  // creator (which we display as Unassigned). Without this, picking yourself
  // on a freshly-submitted item is a no-op because the comparison says
  // nothing changed.
  const [ownerDirty, setOwnerDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { searchUsers, resolveUserLabel } = useUserSearch();
  const createNote = useCreateNote(id ?? '');
  // Resolve-response dialog (opens when saving a transition INTO Resolved).
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [resolveResponse, setResolveResponse] = useState('');
  const [onHoldDialogOpen, setOnHoldDialogOpen] = useState(false);
  const [onHoldResponse, setOnHoldResponse] = useState('');

  useEffect(() => {
    if (item) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus(item.pmo_status ?? FEEDBACK_STATUS.New);
      setPriority(item.pmo_priority ?? null);
      setOwnerDirty(false);
      // Trust the persisted owner. Dataverse stamps the creator as the initial
      // owner; the list view labels that case with a '(submitter)' hint so
      // admins can still spot un-triaged rows without us second-guessing the
      // picker value here (which caused a self-assign no-op bug).
      setOwnerId(item['_pmo_assignedto_value'] ?? null);
    }
  }, [item]);

  const { data: attachments = [] } = useQuery({
    queryKey: ['feedbackAttachments', id],
    queryFn: () => listDocuments({ recordType: 'Feedback', recordId: id! }),
    enabled: !!id,
  });

  async function handleUploadAttachment(file: File) {
    if (!id || !file) return;
    setUploading(true);
    try {
      await uploadDocumentAndConfirm(file, { recordType: 'Feedback', recordId: id });
      qc.invalidateQueries({ queryKey: ['feedbackAttachments', id] });
      toast.success('Attachment uploaded');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // Save button gate: assignee guard, then — when this save transitions the
  // item INTO Resolved — open the response dialog instead of saving directly.
  // Every other save (and both dialog buttons) funnel through performSave.
  function handleSave() {
    if (!id) return;
    if (status !== FEEDBACK_STATUS.New && !ownerId) {
      toast.error('Assign this item to someone before changing its status.');
      return;
    }
    const transitioningToResolved =
      status === FEEDBACK_STATUS.Resolved && item?.pmo_status !== FEEDBACK_STATUS.Resolved;
    if (transitioningToResolved) {
      setResolveResponse('');
      setResolveDialogOpen(true);
      return;
    }
    const transitioningToOnHold =
      status === FEEDBACK_STATUS.OnHold && item?.pmo_status !== FEEDBACK_STATUS.OnHold;
    if (transitioningToOnHold) {
      setOnHoldResponse('');
      setOnHoldDialogOpen(true);
      return;
    }
    void performSave(null);
  }

  // The actual persist.
  //   resolveResponseText: admin message on an into-Resolved save (null otherwise).
  //   onHold: { responseText, notify } on an into-On-Hold save (null otherwise).
  //           notify=false → record the note but send NO creator notification.
  async function performSave(
    resolveResponseText: string | null,
    onHold: { responseText: string; notify: boolean } | null = null,
  ) {
    if (!id) return;
    setResolveDialogOpen(false);
    setOnHoldDialogOpen(false);
    setSaving(true);
    try {
      const payload: Parameters<typeof updateUserFeedback>[1] = {
        pmo_status: status,
        pmo_priority: priority ?? undefined,
      };
      // Auto-manage Date Resolved based on status. Stamp the current
      // local date when transitioning INTO Resolved; clear it when moving
      // OUT of Resolved. Skip the stamp on no-op saves where status is
      // already Resolved so we preserve the original resolution date.
      const wasResolved = item?.pmo_status === FEEDBACK_STATUS.Resolved;
      const isResolved = status === FEEDBACK_STATUS.Resolved;
      if (isResolved && !wasResolved) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        payload.pmo_dateresolved = `${yyyy}-${mm}-${dd}`;
      } else if (!isResolved && wasResolved) {
        payload.pmo_dateresolved = null;
      }
      // ownerid binds to systemusers (we only let users pick people). Send the
      // bind whenever the admin explicitly interacted with the picker, even if
      // the resolved user id matches what's already on the record - we don't
      // try to second-guess the user's intent here.
      if (ownerDirty) {
        payload['pmo_AssignedTo@odata.bind'] = ownerId ? `/systemusers(${ownerId})` : null;
      }
      // Mark this row as in-flight BEFORE the navigate so the list paints the
      // dim-row + spinner on first render instead of flashing the stale row.
      markFeedbackSaving(id);
      try {
        await updateUserFeedback(id, payload);
        if (ownerDirty && ownerId && ownerId !== (item?.['_pmo_assignedto_value'] ?? null)) {
          void emitFeedbackAssigned({
            assigneeUserId: ownerId,
            actorUserId: currentUserId,
            feedbackId: id,
            feedbackTitle: item?.pmo_title ?? 'a feedback item',
            kind: item?.pmo_feedbacktype === FEEDBACK_TYPE.Enhancement ? 'enhancement' : 'bug',
          });
        }
        // Notify the ORIGINAL submitter when this item transitions INTO
        // Resolved, including who completed it + the admin response. Uses the
        // same into-Resolved condition as the pmo_dateresolved stamp so a
        // re-save of an already-Resolved item does not double-notify.
        if (isResolved && !wasResolved) {
          // "Completed by" = the CURRENT assignee. If the admin just picked an
          // assignee in this same save (ownerDirty), the Dataverse column's
          // FormattedValue is still stale, so resolve the name from the picked
          // id; otherwise fall back to the persisted FormattedValue.
          let resolvedByName = item?.['_pmo_assignedto_value@OData.Community.Display.V1.FormattedValue'];
          if (ownerDirty && ownerId) {
            try { resolvedByName = await resolveUserLabel(ownerId); }
            catch { /* keep fallback */ }
          } else if (ownerDirty && !ownerId) {
            resolvedByName = undefined; // assignment was cleared this save
          }
          const responseText = (resolveResponseText ?? '').trim();
          // ALWAYS record a note capturing who resolved it + when. Title is fixed;
          // body is the admin's message (or empty). Resolve the actor's name for
          // the title (fall back to a generic label).
          let actorName = 'A user';
          if (currentUserId) {
            try { actorName = await resolveUserLabel(currentUserId); } catch { /* keep fallback */ }
          }
          void createNote.mutateAsync({
            parentId: id,
            parentEntitySet: 'pmo_userfeedbacks',
            title: `${actorName} changed the ticket status to Resolved`,
            body: responseText,
            authorId: currentUserId ?? undefined,
            authorName: actorName,
          }).catch((e) => console.warn('[feedback] resolve note failed (non-fatal):', e));
          // Notify the original creator; the typed response (if any) is the body.
          void emitFeedbackResolved({
            submitterUserId: item?.['_createdby_value'],
            feedbackId: id,
            feedbackTitle: item?.pmo_title ?? 'a feedback item',
            kind: item?.pmo_feedbacktype === FEEDBACK_TYPE.Enhancement ? 'enhancement' : 'bug',
            resolvedByName,
            responseText: responseText || null,
            actorUserId: currentUserId,
          });
        }

        // On Hold: mirror the resolve flow. ALWAYS record a note (who + when);
        // the creator notification fires ONLY when the admin chose "On Hold & Send".
        const wasOnHold = item?.pmo_status === FEEDBACK_STATUS.OnHold;
        const isOnHold = status === FEEDBACK_STATUS.OnHold;
        if (onHold && isOnHold && !wasOnHold) {
          const holdText = (onHold.responseText ?? '').trim();
          let actorName = 'A user';
          if (currentUserId) {
            try { actorName = await resolveUserLabel(currentUserId); } catch { /* keep fallback */ }
          }
          void createNote.mutateAsync({
            parentId: id,
            parentEntitySet: 'pmo_userfeedbacks',
            title: `${actorName} changed the ticket status to On Hold`,
            body: holdText,
            authorId: currentUserId ?? undefined,
            authorName: actorName,
          }).catch((e) => console.warn('[feedback] on-hold note failed (non-fatal):', e));
          if (onHold.notify) {
            void emitFeedbackOnHold({
              submitterUserId: item?.['_createdby_value'],
              feedbackId: id,
              feedbackTitle: item?.pmo_title ?? 'a feedback item',
              kind: item?.pmo_feedbacktype === FEEDBACK_TYPE.Enhancement ? 'enhancement' : 'bug',
              responseText: holdText || null,
              actorUserId: currentUserId,
            });
          }
        }
        toast.success('Feedback updated');
        navigate('/admin/user-feedback');
        // Force the list to re-fetch with the new values; once that promise
        // settles, drop the dim marker. invalidate -> refetch chain happens
        // automatically inside react-query when the list page is mounted.
        await qc.invalidateQueries({ queryKey: ['userFeedback'] });
        qc.invalidateQueries({ queryKey: ['userFeedback', id] });
      } finally {
        clearFeedbackSaving(id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="space-y-6">
        <PageHeader title="Feedback Detail" showBack onBack={() => navigate(backTarget)} />
        <ErrorBanner error={error as Error | null} />
      </div>
    );
  }

  const hasChanges = status !== (item.pmo_status ?? FEEDBACK_STATUS.New) || (priority ?? null) !== (item.pmo_priority ?? null) || ownerDirty;
  const creatorName = item['_createdby_value@OData.Community.Display.V1.FormattedValue'] ?? 'the original creator';

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title={item.pmo_title}
        showBack
        onBack={() => navigate(backTarget)}
        actions={
          <Button size="sm" onClick={handleSave} disabled={saving || !hasChanges}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}
            {saving ? 'Saving…' : 'Save'}
          </Button>
        }
      />

      {/* Priority - editable */}
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Priority</p>
        <Select
          value={priority == null ? PRIORITY_UNSET : String(priority)}
          onValueChange={(v) => setPriority(v === PRIORITY_UNSET ? null : Number(v))}
        >
          <SelectTrigger className="w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Description — sanitized rich text (renderRichText). */}
      <FieldBlock label="Description">
        {item.pmo_description ? (
          <div
            className="text-sm text-foreground [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1"
            dangerouslySetInnerHTML={renderRichText(item.pmo_description)}
          />
        ) : (
          <p className="text-sm text-muted-foreground italic">No description provided.</p>
        )}
      </FieldBlock>

      {/* Attachments / screenshots */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Attachments</p>
          <label className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline cursor-pointer">
            <ImagePlus className="h-3.5 w-3.5" />
            {uploading ? 'Uploading...' : 'Add file'}
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUploadAttachment(f);
              }}
            />
          </label>
        </div>
        {attachments.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No attachments.</p>
        ) : (
          <ul className="space-y-2">
            {attachments.map((a) => (
              <AttachmentItem key={a.annotationId} attachment={a} />
            ))}
          </ul>
        )}
      </div>

      {/* Submitted By */}
      <FieldBlock label="Submitted By">
        <p className="text-sm text-foreground">
          {item['_createdby_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}
        </p>
      </FieldBlock>

      {/* Submitted On */}
      <FieldBlock label="Submitted On">
        <p className="text-sm text-foreground">
          {fmtDateOnly(item.createdon)}
        </p>
      </FieldBlock>

      {/* Status — editable */}
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Status</p>
        <Select value={String(status)} onValueChange={(v) => setStatus(Number(v))}>
          <SelectTrigger className="w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Assigned To */}
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Assigned To</p>
        <SearchableSelect
          value={ownerId ?? ''}
          onChange={(v) => { setOwnerId(v || null); setOwnerDirty(true); }}
          onSearch={searchUsers}
          resolveLabel={resolveUserLabel}
          placeholder="Search for a user to assign..."
        />
      </div>

      {/* Admin Response — a discrete, stored thread (annotation-backed notes)
          with rich text + @mentions + clipboard paste, like project/task notes.
          Legacy single-field responses (pre-thread) render read-only above. */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Admin Response</p>
        {(item.pmo_responsecomments ?? '').trim() && (
          <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Legacy response</p>
            <div
              className="text-sm text-foreground leading-relaxed [&_a]:text-primary [&_a]:underline [&_a.mention]:no-underline [&_a.mention]:bg-primary/10 [&_a.mention]:text-primary [&_a.mention]:font-medium [&_a.mention]:rounded [&_a.mention]:px-1"
              dangerouslySetInnerHTML={renderRichText(item.pmo_responsecomments)}
            />
          </div>
        )}
        {id && (
          <NotesSection scope={{ kind: 'feedback', feedbackId: id, feedbackTitle: item.pmo_title }} />
        )}
      </div>

      {/* Date Resolved — read-only, auto-stamped on Resolved. Only shown once
       *  Resolved (users can't input it, so nothing to show before then). */}
      {status === FEEDBACK_STATUS.Resolved && (
        <FieldBlock label="Date Resolved">
          <p className="text-sm text-foreground">
            {fmtDateOnly(item.pmo_dateresolved)}
          </p>
        </FieldBlock>
      )}

      {/* Resolve dialog — shown when saving a transition INTO Resolved. The
          admin can add a message for the original creator; either way a note
          recording who resolved it + when is written to the thread. */}
      <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve this ticket</DialogTitle>
            <DialogDescription>
              Optionally add a response for the person who submitted it. A record of
              this resolution (who + when) is saved either way.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={resolveResponse}
            onChange={(e) => setResolveResponse(e.target.value)}
            placeholder={`Write a response for ${creatorName}… (optional)`}
            rows={5}
            autoFocus
          />
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => void performSave(null)}
              disabled={saving}
            >
              Resolve without response
            </Button>
            <div className="flex flex-col items-end gap-0.5">
              <Button
                onClick={() => void performSave(resolveResponse)}
                disabled={saving || !resolveResponse.trim()}
              >
                Resolve &amp; Send
              </Button>
              <span className="text-[10px] text-muted-foreground">
                (this will be sent to {creatorName})
              </span>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* On Hold dialog — mirrors Resolve. "On Hold & Send" notifies the creator;
          "On Hold without Response" records the note only (no notification). */}
      <Dialog open={onHoldDialogOpen} onOpenChange={setOnHoldDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Place this ticket on hold</DialogTitle>
            <DialogDescription>
              Optionally add a response for {creatorName}. A record of this status
              change (who + when) is saved either way; a notification is sent only
              if you choose &ldquo;On Hold &amp; Send&rdquo;.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={onHoldResponse}
            onChange={(e) => setOnHoldResponse(e.target.value)}
            placeholder={`Write a response for ${creatorName}… (optional)`}
            rows={5}
            autoFocus
          />
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => void performSave(null, { responseText: '', notify: false })}
              disabled={saving}
            >
              On Hold without Response
            </Button>
            <div className="flex flex-col items-end gap-0.5">
              <Button
                onClick={() => void performSave(null, { responseText: onHoldResponse, notify: true })}
                disabled={saving || !onHoldResponse.trim()}
              >
                On Hold &amp; Send
              </Button>
              <span className="text-[10px] text-muted-foreground">
                (this will be sent to {creatorName})
              </span>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Single attachment row. For images we lazily fetch the binary through the
 * Power Apps SDK and render it as a blob URL thumbnail - the Power Apps host
 * runs on powerplatformusercontent.com so a direct documentbody/\$value link
 * 404s with RouteNotFound. Clicking the row opens the same blob in a new tab.
 */
function AttachmentItem({ attachment }: { attachment: DocumentItem }) {
  async function handleOpen() {
    try {
      await openDocument(attachment);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open attachment');
    }
  }

  return (
    <li className="rounded-md border bg-muted/20 p-2">
      <button
        type="button"
        onClick={handleOpen}
        className="flex items-center gap-2 text-sm text-primary hover:underline w-full text-left"
      >
        <Paperclip className="h-3.5 w-3.5" />
        <span className="truncate">{attachment.fileName ?? 'attachment'}</span>
        {attachment.fileSizeBytes != null && <span className="text-xs text-muted-foreground ml-auto">{(attachment.fileSizeBytes / 1024).toFixed(0)} KB</span>}
        <FileSourceBadge source={attachment.source} />
      </button>
    </li>
  );
}
