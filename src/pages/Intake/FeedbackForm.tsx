import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bug, Lightbulb, Loader2, ChevronLeft, ImagePlus, X, Paperclip } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { PageHeader } from '../../components/layout/PageHeader';
import { useCreateUserFeedback, useUpdateUserFeedback } from '../../hooks/useUserFeedback';
import { getUserFeedback } from '../../api/userFeedback.api';
import { FEEDBACK_TYPE, FEEDBACK_STATUS } from '../../lib/constants';
import { toast } from '../../hooks/useToast';
import { listDocuments, uploadDocumentAndConfirm, openDocument } from '../../lib/sharePointClient';
import { toFriendlyError } from '../../lib/utils';
import { useImagePaste } from '../../hooks/useImagePaste';
import { isRichTextEmpty } from '../../components/common/RichTextEditor';
import { RichNoteEditor } from '../../components/common/RichNoteEditor';

interface Props {
  type: 'bug' | 'enhancement';
}

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5 MB per file
const MAX_SCREENSHOT_COUNT = 5;                // cap so users don't upload a stack

interface PendingScreenshot {
  file: File;
  previewUrl: string;
}

export function FeedbackForm({ type }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: draftId } = useParams<{ id: string }>();
  // Back target depends on where the form was opened from (router state):
  //   'intake'        → the intake queue (resuming a draft)
  //   'userFeedback'  → the admin User Feedback triage grid
  //   otherwise ("New Request") → the request-type picker.
  const backFrom = (location.state as { from?: string } | null)?.from;
  const backTarget = backFrom === 'intake'
    ? '/intake'
    : backFrom === 'userFeedback'
      ? '/admin/user-feedback'
      : '/intake/new';
  const createFeedback = useCreateUserFeedback();
  const updateFeedback = useUpdateUserFeedback();
  // When editing an existing draft, load it and prefill the form fields.
  const { data: existing } = useQuery({
    queryKey: ['userFeedback', draftId],
    queryFn: () => getUserFeedback(draftId!),
    enabled: !!draftId,
  });
  // Attachments already saved on this draft. They were uploaded on the previous
  // save (as annotations); show them so the user sees their screenshots persist.
  const { data: existingAttachments = [] } = useQuery({
    queryKey: ['intakeAttachments', draftId],
    queryFn: () => listDocuments({ recordType: 'Feedback', recordId: draftId! }),
    enabled: !!draftId,
  });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [screenshots, setScreenshots] = useState<PendingScreenshot[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Prefill from the loaded draft (title + description). Existing screenshots
  // already live as annotations on the record; new pastes/uploads append on save.
  useEffect(() => {
    if (existing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTitle(existing.pmo_title ?? '');
      setDescription(existing.pmo_description ?? '');
    }
  }, [existing]);

  const isBug = type === 'bug';
  const feedbackType = isBug ? FEEDBACK_TYPE.BugReport : FEEDBACK_TYPE.Enhancement;

  const acceptScreenshot = useCallback(
    (file: File, opts?: { skipNonImageWarn?: boolean }) => {
      if (!file.type.startsWith('image/')) {
        if (!opts?.skipNonImageWarn) toast.error(`${file.name}: only image files are supported.`);
        return false;
      }
      if (file.size > MAX_SCREENSHOT_BYTES) {
        toast.error(`${file.name}: screenshot must be smaller than 5 MB.`);
        return false;
      }
      setScreenshots((prev) => {
        if (prev.length >= MAX_SCREENSHOT_COUNT) {
          toast.error(`Up to ${MAX_SCREENSHOT_COUNT} screenshots per submission.`);
          return prev;
        }
        return [...prev, { file, previewUrl: URL.createObjectURL(file) }];
      });
      return true;
    },
    [],
  );

  // Clipboard paste — any image pasted while this form is mounted gets added
  // as a screenshot. Skips the save-to-disk-then-upload dance for screen captures.
  useImagePaste(useCallback((file: File) => {
    if (acceptScreenshot(file, { skipNonImageWarn: true })) {
      toast.success('Screenshot pasted from clipboard.');
    }
  }, [acceptScreenshot]));

  function handleSelectFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    for (const file of files) acceptScreenshot(file);
  }

  function removeScreenshot(index: number) {
    setScreenshots((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await save(FEEDBACK_STATUS.New);
  }

  /** Save as a draft: the author can come back and finish it later. Only the
   *  title is required -- the whole point of a draft is that it is incomplete. */
  async function handleSaveDraft() {
    await save(FEEDBACK_STATUS.Draft);
  }

  /**
   * Shared create path for both Submit and Save-as-Draft. The only difference is
   * the status written and the wording of the confirmation, so the screenshot
   * upload loop and error handling stay in one place.
   */
  async function save(status: number) {
    if (!title.trim()) return;
    const isDraft = status === FEEDBACK_STATUS.Draft;

    if (isDraft) setSavingDraft(true); else setSubmitting(true);
    try {
      if (draftId) {
        await updateFeedback.mutateAsync({
          id: draftId,
          payload: {
            pmo_title: title.trim(),
            pmo_description: isRichTextEmpty(description) ? undefined : description,
            pmo_status: status,
          },
        });
      }
      const created = draftId ? { pmo_userfeedbackid: draftId } : await createFeedback.mutateAsync({
        pmo_title: title.trim(),
        pmo_description: isRichTextEmpty(description) ? undefined : description,
        pmo_feedbacktype: feedbackType,
        pmo_status: status,
        pmo_sourcecontext: window.location.pathname.slice(0, 900),
      });
      // Upload each screenshot as a Dataverse annotation on the new feedback record.
      // Best-effort: if any individual upload fails, the feedback row still exists.
      // Track and surface the count so the user knows which made it.
      let uploadedCount = 0;
      let failedCount = 0;
      if (screenshots.length > 0 && created.pmo_userfeedbackid) {
        for (const s of screenshots) {
          try {
            await uploadDocumentAndConfirm(s.file, { recordType: 'Feedback', recordId: created.pmo_userfeedbackid });
            uploadedCount += 1;
          } catch (err) {
            console.warn('[FeedbackForm] screenshot upload failed', s.file.name, err);
            failedCount += 1;
          }
        }
        if (failedCount > 0) {
          toast.error(
            `Feedback saved (${uploadedCount}/${screenshots.length} screenshot${screenshots.length === 1 ? '' : 's'} uploaded). You can add the rest from the detail page.`,
          );
        }
      }
      if (isDraft) {
        toast.success('Draft saved — finish it any time from the intake queue.');
      } else {
        toast.success(isBug ? 'Bug report submitted — thank you!' : 'Enhancement suggestion submitted — thank you!');
      }
      navigate('/intake');
    } catch (err) {
      toast.error(toFriendlyError(err, isDraft ? 'Failed to save draft' : 'Failed to submit feedback'));
    } finally {
      if (isDraft) setSavingDraft(false); else setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title={isBug ? 'Report a Bug' : 'Suggest an Enhancement'}
        subtitle={isBug
          ? 'Describe the issue you encountered so the team can investigate'
          : 'Share your idea for improving the application'
        }
        showBack
        onBack={() => navigate(backTarget)}
      />

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-4">
          {isBug
            ? <Bug className="h-5 w-5 text-rose-500 shrink-0" />
            : <Lightbulb className="h-5 w-5 text-amber-500 shrink-0" />
          }
          <p className="text-sm text-muted-foreground">
            {isBug
              ? 'Bug reports help the team identify and fix issues. Include steps to reproduce and screenshots if possible.'
              : 'Enhancement suggestions help shape the product roadmap. Be as specific as you can about the desired behavior.'
            }
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Title <span className="text-destructive">*</span>
          </Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={isBug ? 'Brief summary of the bug' : 'Brief summary of your suggestion'}
            required
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Description
          </Label>
          <RichNoteEditor
            value={description}
            onChange={setDescription}
            placeholder={isBug
              ? 'What happened? What did you expect? Steps to reproduce...'
              : 'Describe the enhancement and how it would help your workflow...'
            }
            rows={6}
          />
          <p className="text-[10px] text-muted-foreground italic">
            Tip: paste a screenshot here with Ctrl+V to skip the save-and-upload step.
          </p>
        </div>

        {/* Screenshots upload — multiple allowed */}
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Screenshots {isBug ? '(recommended)' : '(optional)'}
          </Label>
          <div className="space-y-2">
            {/* Attachments already saved on this draft (from a prior save). */}
            {existingAttachments.length > 0 && (
              <ul className="space-y-1.5">
                {existingAttachments.map((a) => (
                  <li key={a.annotationId} className="rounded-md border bg-muted/20 p-2">
                    <button
                      type="button"
                      onClick={() => { void openDocument(a).catch(() => toast.error('Could not open attachment')); }}
                      className="flex items-center gap-2 text-sm text-primary hover:underline w-full text-left"
                    >
                      <Paperclip className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{a.fileName ?? 'attachment'}</span>
                      {a.fileSizeBytes != null && <span className="text-xs text-muted-foreground ml-auto">{(a.fileSizeBytes / 1024).toFixed(0)} KB</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {screenshots.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {screenshots.map((s, i) => (
                  <div key={`${s.file.name}-${i}`} className="relative rounded-md border border-input bg-muted/10 p-2 group">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeScreenshot(i)}
                      className="absolute top-1 right-1 h-6 w-6 p-0 bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label={`Remove ${s.file.name}`}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                    <img
                      src={s.previewUrl}
                      alt={s.file.name}
                      className="w-full h-32 object-cover rounded border border-border"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1 truncate" title={s.file.name}>
                      {s.file.name} · {(s.file.size / 1024).toFixed(0)} KB
                    </p>
                  </div>
                ))}
              </div>
            )}
            {screenshots.length < MAX_SCREENSHOT_COUNT && (
              <label className="flex items-center justify-center gap-2 rounded-md border border-dashed border-input bg-muted/20 px-4 py-6 cursor-pointer hover:bg-muted/40 transition-colors text-sm text-muted-foreground">
                <ImagePlus className="h-4 w-4" />
                <span>
                  {screenshots.length === 0
                    ? `Click to attach screenshots (PNG / JPG, up to 5 MB each, max ${MAX_SCREENSHOT_COUNT})`
                    : `Add more (${MAX_SCREENSHOT_COUNT - screenshots.length} remaining)`
                  }
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  onChange={handleSelectFiles}
                />
              </label>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={() => navigate(backTarget)}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleSaveDraft}
            disabled={submitting || savingDraft || !title.trim()}
            title={!title.trim() ? 'Enter a title first' : 'Save without submitting — finish it later from the intake queue'}
          >
            {savingDraft && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            {savingDraft ? 'Saving…' : 'Save as Draft'}
          </Button>
          <Button type="submit" disabled={submitting || savingDraft || !title.trim()}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            {submitting ? 'Submitting…' : 'Submit'}
          </Button>
        </div>
      </form>
    </div>
  );
}
