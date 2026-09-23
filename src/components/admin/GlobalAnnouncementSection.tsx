import { useEffect, useRef, useState } from 'react';
import { Save, Loader2, Megaphone, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { useUpsertSetting } from '../../hooks/useAppSettings';
import { useGlobalAnnouncement } from '../../hooks/useGlobalAnnouncement';
import { SETTING_GLOBAL_ANNOUNCEMENT_KEY, type GlobalAnnouncement } from '../../lib/globalAnnouncement';
import { toast } from '../../hooks/useToast';
import { EmojiPickerPopover } from '../teams/EmojiPickerPopover';
import { GifPickerPopover } from '../teams/GifPickerPopover';

export function GlobalAnnouncementSection() {
  const stored = useGlobalAnnouncement();
  const upsert = useUpsertSetting();

  const [draft, setDraft] = useState<GlobalAnnouncement>(stored);

  useEffect(() => {
    setDraft(stored); // eslint-disable-line react-hooks/set-state-in-effect
  }, [stored.title, stored.body, stored.enabled, stored.version, stored.updatedAt, stored.ackMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refs for cursor-aware emoji insertion (mirrors BulletinComposer).
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  function insertEmojiInTitle(emoji: string) {
    const el = titleRef.current;
    if (!el) {
      setDraft((d) => ({ ...d, title: d.title + emoji }));
      return;
    }
    const start = el.selectionStart ?? draft.title.length;
    const end = el.selectionEnd ?? draft.title.length;
    const next = draft.title.slice(0, start) + emoji + draft.title.slice(end);
    setDraft((d) => ({ ...d, title: next }));
    requestAnimationFrame(() => {
      const pos = start + emoji.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function insertEmojiInBody(emoji: string) {
    const el = bodyRef.current;
    if (!el) {
      setDraft((d) => ({ ...d, body: d.body + emoji }));
      return;
    }
    const start = el.selectionStart ?? draft.body.length;
    const end = el.selectionEnd ?? draft.body.length;
    const next = draft.body.slice(0, start) + emoji + draft.body.slice(end);
    setDraft((d) => ({ ...d, body: next }));
    requestAnimationFrame(() => {
      const pos = start + emoji.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  const isDirty =
    draft.title !== stored.title ||
    draft.body !== stored.body ||
    (draft.bodyGifUrl ?? '') !== (stored.bodyGifUrl ?? '') ||
    draft.enabled !== stored.enabled ||
    draft.ackMode !== stored.ackMode;

  async function handleSave() {
    const contentChanged =
      draft.title.trim() !== stored.title ||
      draft.body !== stored.body ||
      (draft.bodyGifUrl ?? '') !== (stored.bodyGifUrl ?? '');
    const next: GlobalAnnouncement = {
      title: draft.title.trim(),
      body: draft.body,
      bodyGifUrl: draft.bodyGifUrl?.trim() || undefined,
      enabled: draft.enabled,
      ackMode: draft.ackMode,
      // Auto-bump the version when the CONTENT changes so Single-Time-Ack users
      // who already acked see the new message. Pure enable/ackMode flips don't bump.
      version: contentChanged ? (stored.version ?? 1) + 1 : stored.version,
      updatedAt: new Date().toISOString(),
    };
    try {
      await upsert.mutateAsync({
        key: SETTING_GLOBAL_ANNOUNCEMENT_KEY,
        value: JSON.stringify(next),
      });
      toast.success(
        next.enabled
          ? 'Global announcement saved — every user will see it on next app load.'
          : 'Global announcement saved (disabled — popup will not fire).',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Couldn't save announcement: ${msg}`);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Global Announcement</h3>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
            className="h-3.5 w-3.5 rounded border-border accent-primary"
          />
          Enabled
        </label>
      </div>

      <p className="text-xs text-muted-foreground -mt-2">
        Authored content appears as a popup on app launch for{' '}
        <strong>every user</strong>. Each user acknowledges per session — refreshing brings
        it back until acked again.
      </p>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="global-ann-title" className="text-xs">Title</Label>
          <EmojiPickerPopover onPick={insertEmojiInTitle} triggerLabel="Insert emoji into title" />
        </div>
        <Input
          ref={titleRef}
          id="global-ann-title"
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          placeholder="What users should see at the top of the popup"
          className="text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="global-ann-body" className="text-xs">Body</Label>
          <div className="flex items-center gap-1">
            <EmojiPickerPopover onPick={insertEmojiInBody} triggerLabel="Insert emoji into body" />
            <GifPickerPopover onPick={(url) => setDraft((d) => ({ ...d, bodyGifUrl: url }))} triggerLabel="Add a GIF" />
          </div>
        </div>
        <Textarea
          ref={bodyRef}
          id="global-ann-body"
          value={draft.body}
          onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
          rows={10}
          placeholder="Full announcement text. Line breaks are preserved."
          className="text-sm leading-relaxed"
        />
        {draft.bodyGifUrl && (
          <div className="relative inline-block">
            <img
              src={draft.bodyGifUrl}
              alt="Attached GIF"
              className="max-h-40 rounded-md border border-border"
            />
            <button
              type="button"
              onClick={() => setDraft((d) => ({ ...d, bodyGifUrl: undefined }))}
              className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-foreground/80 text-background flex items-center justify-center"
              aria-label="Remove GIF"
              title="Remove GIF"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-1">
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">Acknowledgement</p>
          <div className="flex gap-2">
            {([
              { val: 'single' as const, label: 'Single-Time Ack', hint: 'Ask each user once; never again after they ack.' },
              { val: 'everyLoad' as const, label: 'Every Load Ack', hint: 'Show on every app load until acked that session.' },
            ]).map((opt) => (
              <button
                key={opt.val}
                type="button"
                title={opt.hint}
                onClick={() => setDraft((d) => ({ ...d, ackMode: opt.val }))}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${draft.ackMode === opt.val ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground hover:bg-muted/40"}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {draft.ackMode === 'everyLoad'
              ? 'Users are asked on every app load until they acknowledge that session.'
              : 'Users are asked once; after acknowledging they are never asked again (editing the content re-asks).'}
          </p>
        </div>
        <div className="text-[11px] text-muted-foreground">
          {stored.updatedAt && (
            <>Last edited {new Date(stored.updatedAt).toLocaleString()} · v{stored.version}</>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={!isDirty || upsert.isPending}>
          {upsert.isPending
            ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            : <Save className="h-3.5 w-3.5 mr-1.5" />}
          {upsert.isPending ? 'Saving…' : 'Save announcement'}
        </Button>
      </div>
    </div>
  );
}
