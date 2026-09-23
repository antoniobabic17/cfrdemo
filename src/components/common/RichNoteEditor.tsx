/**
 * RichNoteEditor — the unified composer: light rich text + @mentions + emoji +
 * image/clipboard paste. One control used by project/task notes, the feedback
 * admin-response feed, and the bug/enhancement Description fields. NOT used in
 * the intake wizard.
 *
 * Stored value = sanitized HTML (see RichTextEditor.sanitizeRichText, extended
 * to allow mention-chip anchors). Mentions are non-editable anchor chips
 * (richMentions.buildMentionChip) carrying data-userid; extractMentionUserIds
 * pulls those ids out for notifications on save. Legacy plain-text / canonical
 * `@[Name](id)` values render as chips via renderRichText.
 *
 * contentEditable + document.execCommand (same rationale as RichTextEditor — no
 * 100KB editor dep for a 6-button surface). Image paste is intercepted at the
 * editor and handed to the host via onImagePaste so it attaches the file rather
 * than inlining a base64 blob.
 */
import { useEffect, useRef, useState } from 'react';
import { Bold, Italic, List, ListOrdered, Link2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { sanitizeRichText } from './RichTextEditor';
import { htmlToPlainText } from '../../lib/htmlToPlainText';
import { buildMentionChip } from '../../lib/richMentions';
import { MentionAutocomplete, type MentionCandidate } from '../teams/MentionAutocomplete';
import { EmojiPickerPopover } from '../teams/EmojiPickerPopover';
import { useUserSearch } from '../../hooks/useIntakeLookups';

interface Props {
  /** Sanitized-HTML value. */
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  className?: string;
  /** Fired for each pasted image File; host attaches it. When omitted, image
   *  pastes are ignored (text/html paste still handled). */
  onImagePaste?: (file: File) => void;
  /** Ctrl/Cmd+Enter shortcut. */
  onSubmitShortcut?: () => void;
}

export function RichNoteEditor({
  value, onChange, placeholder, rows = 4, disabled, className, onImagePaste, onSubmitShortcut,
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [trigger, setTrigger] = useState<{ query: string } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [candidates, setCandidates] = useState<MentionCandidate[]>([]);
  const { searchUsers } = useUserSearch();

  // Sync external value into the DOM when it differs and we're not focused
  // (avoid caret loss on every keystroke roundtrip). Mirrors RichTextEditor.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.innerHTML === value) return;
    el.innerHTML = value || '';
  }, [value]);

  function emit() {
    onChange(editorRef.current?.innerHTML ?? '');
  }

  // Debounced org-wide user search for the active @-trigger.
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

  function exec(cmd: string, arg?: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, arg);
    if (cmd === 'createLink' && editorRef.current) {
      editorRef.current.innerHTML = sanitizeRichText(editorRef.current.innerHTML);
    }
    emit();
  }

  /** Read the text immediately before the caret to detect an "@query" trigger.
   *  Only supports the common case: caret inside a single text node. */
  function detectTrigger(): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) { setTrigger(null); return; }
    const node = sel.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE) { setTrigger(null); return; }
    const text = (node.textContent ?? '').slice(0, sel.anchorOffset);
    const m = /(?:^|\s)@([^\s@]*)$/.exec(text);
    setTrigger(m ? { query: m[1] } : null);
  }

  function handleInput() {
    emit();
    detectTrigger();
  }

  function pickMention(c: MentionCandidate) {
    const el = editorRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) { setTrigger(null); return; }
    const node = sel.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE) { setTrigger(null); return; }
    const offset = sel.anchorOffset;
    const before = (node.textContent ?? '').slice(0, offset);
    const after = (node.textContent ?? '').slice(offset);
    // Strip the "@query" the user typed, then insert the chip HTML + a space.
    const atIdx = before.lastIndexOf('@');
    if (atIdx < 0) { setTrigger(null); return; }
    const beforeAt = before.slice(0, atIdx);
    // Rebuild: text-before-@  +  chip  +  nbsp  +  text-after
    const range = document.createRange();
    range.selectNode(node);
    const frag = document.createElement('span');
    frag.innerHTML = `${escapeText(beforeAt)}${buildMentionChip(c.name, c.userId)}&nbsp;${escapeText(after)}`;
    node.parentNode?.replaceChild(frag, node);
    // Unwrap the span so we don't nest a stray element. Collect the inserted
    // children so we can place the caret after the trailing space.
    const inserted: Node[] = [];
    while (frag.firstChild) {
      const child = frag.firstChild;
      frag.parentNode?.insertBefore(child, frag);
      inserted.push(child);
    }
    frag.parentNode?.removeChild(frag);
    setTrigger(null);
    // Place the caret immediately after the trailing space that follows the
    // chip so the user keeps typing right after the mention, not at the end
    // of the whole field. Inserted sequence:
    //   [beforeAt textNode]  [chip <a>]  ['\u00a0' textNode]  [after textNode]
    // We want offset 1 in the '\u00a0' node (after the space).
    const spaceNode = inserted.find(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').includes('\u00a0'),
    );
    requestAnimationFrame(() => {
      el.focus();
      const sel = window.getSelection();
      if (sel && spaceNode) {
        const r = document.createRange();
        r.setStart(spaceNode, 1); // after the &nbsp;
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    });
    emit();
  }

  function insertEmoji(emoji: string) {
    editorRef.current?.focus();
    document.execCommand('insertText', false, emoji);
    emit();
  }

  function handlePaste(e: React.ClipboardEvent) {
    // Image paste → hand to host (attach), don't inline.
    const imageItem = Array.from(e.clipboardData.items).find(
      (it) => it.kind === 'file' && it.type.startsWith('image/'),
    );
    if (imageItem && onImagePaste) {
      const blob = imageItem.getAsFile();
      if (blob) {
        e.preventDefault();
        const ext = (blob.type.split('/')[1] ?? 'png').toLowerCase();
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        onImagePaste(new File([blob], `screenshot-${ts}.${ext}`, { type: blob.type }));
        return;
      }
    }
    // Text paste → insert as PLAIN TEXT only. Pasting rich content from
    // Copilot chats / Outlook emails used to drag in a wall of nested spans +
    // inline styles that leaked through as visible markup; users want the
    // words, not the formatting. Prefer text/plain; when the clipboard only
    // carries text/html, strip it to text before inserting.
    const text = e.clipboardData.getData('text/plain');
    const html = e.clipboardData.getData('text/html');
    if (!text && !html) return;
    e.preventDefault();
    const plain = text || htmlToPlainText(html);
    const insert = plain
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/\r\n?/g, '\n')
      .replace(/\n/g, '<br>');
    document.execCommand('insertHTML', false, insert);
    emit();
  }

  function handleInsertLink() {
    const sel = window.getSelection();
    const hasSelection = !!sel && !sel.isCollapsed && sel.toString().trim().length > 0;
    const url = window.prompt('Link URL (https://…):');
    if (!url) return;
    if (hasSelection) {
      exec('createLink', url);
    } else {
      const safe = url.replace(/"/g, '&quot;');
      document.execCommand('insertHTML', false,
        `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>&nbsp;`);
      emit();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
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

  const minHeight = `${Math.max(1, rows) * 1.5}rem`;

  return (
    <div className={cn('rounded-md border border-input bg-background overflow-hidden relative', className)}>
      <div className="flex items-center gap-0.5 px-1 py-1 border-b border-input bg-muted/30">
        <TB onClick={() => exec('bold')} title="Bold (Ctrl+B)" icon={<Bold className="h-3.5 w-3.5" />} />
        <TB onClick={() => exec('italic')} title="Italic (Ctrl+I)" icon={<Italic className="h-3.5 w-3.5" />} />
        <div className="w-px h-4 bg-border mx-1" aria-hidden />
        <TB onClick={() => exec('insertUnorderedList')} title="Bulleted list" icon={<List className="h-3.5 w-3.5" />} />
        <TB onClick={() => exec('insertOrderedList')} title="Numbered list" icon={<ListOrdered className="h-3.5 w-3.5" />} />
        <div className="w-px h-4 bg-border mx-1" aria-hidden />
        <TB onClick={handleInsertLink} title="Insert link" icon={<Link2 className="h-3.5 w-3.5" />} />
        <div className="w-px h-4 bg-border mx-1" aria-hidden />
        <EmojiPickerPopover onPick={insertEmoji} triggerLabel="Insert emoji" />
      </div>
      <div
        ref={editorRef}
        contentEditable={!disabled}
        onInput={handleInput}
        onBlur={emit}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        className={cn(
          'px-3 py-2 text-sm outline-none [&_a]:text-primary [&_a]:underline',
          '[&_a.mention]:no-underline [&_a.mention]:bg-primary/10 [&_a.mention]:text-primary [&_a.mention]:font-medium [&_a.mention]:rounded [&_a.mention]:px-1',
          '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5',
          '[&[data-placeholder]:empty:before]:content-[attr(data-placeholder)]',
          '[&[data-placeholder]:empty:before]:text-muted-foreground',
        )}
        style={{ minHeight }}
      />
      {trigger && candidates.length > 0 && (
        <div className="absolute left-3 bottom-2 z-20">
          <MentionAutocomplete
            candidates={candidates}
            activeIndex={activeIndex}
            onPick={pickMention}
            onActiveIndexChange={setActiveIndex}
          />
        </div>
      )}
    </div>
  );
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function TB({ onClick, title, icon }: { onClick: () => void; title: string; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      className="p-1.5 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground"
    >
      {icon}
    </button>
  );
}

// exported so callers can pull mentioned ids for notifications
export { extractMentionUserIds } from '../../lib/richMentions';
