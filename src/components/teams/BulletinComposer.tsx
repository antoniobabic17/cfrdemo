/**
 * Bulletin composer — textarea with @mention autocomplete, emoji insert,
 * GIF picker, and send button. Used for both top-level posts and replies
 * (parentAnnotationId controls which).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Send, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { EmojiPickerPopover } from './EmojiPickerPopover';
import { GifPickerPopover } from './GifPickerPopover';
import { MentionAutocomplete, type MentionCandidate } from './MentionAutocomplete';
import { detectMentionTrigger, extractMentions, insertMentionAt } from '../../lib/mentionsParser';
import type { BulletinPayload } from '../../lib/bulletinEnvelope';

interface Props {
  members: MentionCandidate[];
  placeholder?: string;
  /** True when composing a reply — render the composer slimmer. */
  compact?: boolean;
  isPending?: boolean;
  onCancel?: () => void;
  onSubmit: (payload: BulletinPayload) => void;
}

export function BulletinComposer({
  members, placeholder, compact, isPending, onCancel, onSubmit,
}: Props) {
  const [body, setBody] = useState('');
  const [gifUrl, setGifUrl] = useState<string | undefined>(undefined);
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const candidates = useMemo<MentionCandidate[]>(() => {
    if (!trigger) return [];
    const q = trigger.query.toLowerCase();
    return members
      .filter((m) => m.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [trigger, members]);

  function syncTrigger(nextBody: string, cursor: number) {
    const t = detectMentionTrigger(nextBody, cursor);
    if (!t) {
      setTrigger(null);
      return;
    }
    setTrigger({ start: t.triggerStart, query: t.query });
  }

  function handleBodyChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setBody(value);
    syncTrigger(value, e.target.selectionStart);
  }

  function pickMention(c: MentionCandidate) {
    if (!trigger || !textareaRef.current) return;
    const cursor = textareaRef.current.selectionStart;
    const { nextBody, nextCursor } = insertMentionAt(body, cursor, trigger.start, c);
    setBody(nextBody);
    setTrigger(null);
    // Restore cursor + focus on next tick (after React applies the value).
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function insertEmoji(emoji: string) {
    if (!textareaRef.current) {
      setBody((b) => b + emoji);
      return;
    }
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const next = body.slice(0, start) + emoji + body.slice(end);
    setBody(next);
    const pos = start + emoji.length;
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(pos, pos);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (trigger && candidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, candidates.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickMention(candidates[activeIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setTrigger(null);
        return;
      }
    }
    // Ctrl/Cmd+Enter submits.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  }

  function buildPayload(): BulletinPayload {
    const mentions = extractMentions(body).map((m) => ({ userId: m.userId, name: m.name }));
    return {
      v: 1,
      body,
      mentions,
      gifUrl,
      reactions: {},
    };
  }

  function handleSubmit() {
    const trimmed = body.trim();
    if (!trimmed && !gifUrl) return;
    if (isPending) return;
    onSubmit(buildPayload());
    setBody('');
    setGifUrl(undefined);
    setTrigger(null);
  }

  // Reset active index whenever the candidate list changes meaningfully.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setActiveIndex(0); }, [trigger?.query, candidates.length]);

  const canSend = (body.trim().length > 0 || !!gifUrl) && !isPending;

  return (
    <div className="rounded-lg border border-border bg-card p-2.5 space-y-2 relative">
      {gifUrl && (
        <div className="relative inline-block">
          <img
            src={gifUrl}
            alt="Attached GIF"
            className="max-h-40 rounded-md border border-border"
          />
          <button
            type="button"
            onClick={() => setGifUrl(undefined)}
            className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-foreground/80 text-background flex items-center justify-center text-xs"
            aria-label="Remove GIF"
            title="Remove GIF"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <Textarea
        ref={textareaRef}
        value={body}
        onChange={handleBodyChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? 'Share something with your team…'}
        rows={compact ? 2 : 3}
        className="text-sm resize-y"
      />

      {trigger && candidates.length > 0 && (
        <div className="absolute left-2 bottom-12 z-10">
          <MentionAutocomplete
            candidates={candidates}
            activeIndex={activeIndex}
            onPick={pickMention}
            onActiveIndexChange={setActiveIndex}
          />
        </div>
      )}

      <div className="flex items-center gap-1">
        <EmojiPickerPopover onPick={insertEmoji} triggerLabel="Insert emoji" />
        <GifPickerPopover onPick={(url) => setGifUrl(url)} />
        <div className="flex-1" />
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
        )}
        <Button type="button" size="sm" onClick={handleSubmit} disabled={!canSend}>
          {isPending
            ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            : <Send className="h-3.5 w-3.5 mr-1.5" />}
          {compact ? 'Reply' : 'Post'}
        </Button>
      </div>
    </div>
  );
}
