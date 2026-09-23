/**
 * MentionTextarea — a textarea with @mention autocomplete (org-wide user
 * search) and emoji insert. Shared by the notes composer and the feedback
 * admin-response field so both behave identically.
 *
 * Value contract: the component's `value`/`onChange` speak the CANONICAL
 * mention form `@[Name](systemuserid)` — the same string that gets stored and
 * later rendered as chips via mentionsParser.renderBody. Internally it shows a
 * FRIENDLY string (`@Name`, no GUID) so the user never sees raw markup, and it
 * re-serializes to canonical on every edit using the set of mentions picked so
 * far (plus any already present in the incoming value).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Textarea } from '../ui/textarea';
import { EmojiPickerPopover } from '../teams/EmojiPickerPopover';
import { MentionAutocomplete, type MentionCandidate } from '../teams/MentionAutocomplete';
import {
  detectMentionTrigger,
  toFriendlyMentions,
  toCanonicalMentions,
} from '../../lib/mentionsParser';
import { useUserSearch } from '../../hooks/useIntakeLookups';

interface Props {
  /** Canonical value (`@[Name](id)` chips inline). */
  value: string;
  /** Emits the canonical value on every change. */
  onChange: (canonical: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  className?: string;
  /** Ctrl/Cmd+Enter handler (optional submit shortcut). */
  onSubmitShortcut?: () => void;
}

export function MentionTextarea({
  value,
  onChange,
  placeholder = 'Write a message… use @ to mention someone',
  rows = 4,
  disabled,
  className,
  onSubmitShortcut,
}: Props) {
  // Seed the friendly view + known mentions from the incoming canonical value.
  const seed = useMemo(() => toFriendlyMentions(value), [value]);
  const [text, setText] = useState(seed.text);
  const [mentions, setMentions] = useState<{ name: string; userId: string }[]>(seed.mentions);
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [candidates, setCandidates] = useState<MentionCandidate[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const { searchUsers } = useUserSearch();

  // Re-sync the friendly view when the canonical value is reset externally
  // (e.g. the parent clears it after save). Compare against the last canonical
  // we emitted so local keystrokes don't clobber the cursor.
  const lastEmitted = useRef(value);
  useEffect(() => {
    if (value === lastEmitted.current) return;
    const next = toFriendlyMentions(value);
    setText(next.text);
    setMentions(next.mentions);
    lastEmitted.current = value;
  }, [value]);

  // Debounced org-wide user search. All setState is inside the async timeout so
  // we never set state synchronously during the effect.
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      if (!trigger) { if (!cancelled) setCandidates([]); return; }
      try {
        const results = await searchUsers(trigger.query);
        if (!cancelled) setCandidates(results.slice(0, 8).map((r) => ({ userId: r.value, name: r.label })));
      } catch {
        if (!cancelled) setCandidates([]);
      }
    }, trigger ? 180 : 0);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [trigger, searchUsers]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setActiveIndex(0); }, [trigger?.query, candidates.length]);

  function emit(friendly: string, ms: { name: string; userId: string }[]) {
    const canonical = toCanonicalMentions(friendly, ms.filter((m) => friendly.includes(`@${m.name}`)));
    lastEmitted.current = canonical;
    onChange(canonical);
  }

  function syncTrigger(next: string, cursor: number) {
    const t = detectMentionTrigger(next, cursor);
    setTrigger(t ? { start: t.triggerStart, query: t.query } : null);
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value);
    emit(e.target.value, mentions);
    syncTrigger(e.target.value, e.target.selectionStart);
  }

  function pickMention(c: MentionCandidate) {
    if (!trigger || !ref.current) return;
    const cursor = ref.current.selectionStart;
    const chip = `@${c.name} `;
    const before = text.slice(0, trigger.start);
    const after = text.slice(cursor);
    const nextText = `${before}${chip}${after}`;
    const nextMentions = mentions.some((m) => m.userId === c.userId) ? mentions : [...mentions, c];
    const nextCursor = before.length + chip.length;
    setText(nextText);
    setMentions(nextMentions);
    emit(nextText, nextMentions);
    setTrigger(null);
    requestAnimationFrame(() => {
      if (!ref.current) return;
      ref.current.focus();
      ref.current.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function insertEmoji(emoji: string) {
    const el = ref.current;
    const start = el ? el.selectionStart : text.length;
    const end = el ? el.selectionEnd : text.length;
    const nextText = text.slice(0, start) + emoji + text.slice(end);
    setText(nextText);
    emit(nextText, mentions);
    const pos = start + emoji.length;
    requestAnimationFrame(() => {
      if (!ref.current) return;
      ref.current.focus();
      ref.current.setSelectionRange(pos, pos);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (trigger && candidates.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, candidates.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(candidates[activeIndex]); return; }
      if (e.key === 'Escape')    { e.preventDefault(); setTrigger(null); return; }
    }
    if (onSubmitShortcut && (e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onSubmitShortcut();
    }
  }

  return (
    <div className="relative space-y-1.5">
      <Textarea
        ref={ref}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className={className ?? 'text-sm resize-y'}
      />
      {trigger && candidates.length > 0 && (
        <div className="absolute left-2 top-full z-20 -mt-1">
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
      </div>
    </div>
  );
}
