import { useEffect, useRef } from 'react';
import { Bold, Italic, List, ListOrdered, Link2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { canonicalMentionsToChips } from '../../lib/richMentions';
import { htmlToPlainText } from '../../lib/htmlToPlainText';

/**
 * Minimal contentEditable rich-text editor. Designed for submission
 * forms (bug reports, enhancement suggestions, comments) where users
 * want light formatting — bold, italic, lists, hyperlinks — but not
 * the full Word/Outlook surface (no images, tables, headings, fonts).
 *
 * Stored value is sanitized HTML. The same sanitize() function used on
 * paste should be used by any read-back surface that renders the value
 * (see renderRichText() below).
 *
 * No external library — contentEditable + document.execCommand. That API
 * is technically deprecated but still works in every browser the Power
 * Apps host targets, and avoids pulling in a 100KB editor dependency
 * for a 5-button toolbar.
 */

const ALLOWED_TAGS = new Set([
  'B', 'I', 'STRONG', 'EM', 'U', 'A', 'UL', 'OL', 'LI', 'BR', 'P', 'DIV', 'SPAN',
]);
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  // Anchors are EITHER a real hyperlink (href/target/rel) OR a mention chip
  // (data-mention/data-userid/class/contenteditable). Both sets allowed here;
  // the A-specific branch in walk() enforces the per-kind rules.
  A: new Set(['href', 'target', 'rel', 'data-mention', 'data-userid', 'class', 'contenteditable']),
};

/** Sanitize an HTML string in-place: drop disallowed tags (keep their text
 *  content), strip disallowed attributes, force anchors to open in a new
 *  tab with safe rel. */
export function sanitizeRichText(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  walk(tpl.content);
  return tpl.innerHTML;
}

function walk(node: Node): void {
  const children = Array.from(node.childNodes);
  for (const child of children) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE) {
      child.parentNode?.removeChild(child);
      continue;
    }
    const el = child as Element;
    if (!ALLOWED_TAGS.has(el.tagName)) {
      // Replace the disallowed element with its text content.
      const text = document.createTextNode(el.textContent ?? '');
      el.parentNode?.replaceChild(text, el);
      continue;
    }
    // Strip disallowed attributes.
    const allowed = ALLOWED_ATTRS[el.tagName] ?? new Set<string>();
    for (const attr of Array.from(el.attributes)) {
      if (!allowed.has(attr.name.toLowerCase())) {
        el.removeAttribute(attr.name);
      }
    }
    // Anchors: mention chips vs real hyperlinks get different treatment.
    if (el.tagName === 'A') {
      if (el.getAttribute('data-mention') === '1') {
        // Mention chip: keep data-userid + class + non-editable, force NO href
        // (it's not a navigable link), normalize class.
        el.removeAttribute('href');
        el.removeAttribute('target');
        el.removeAttribute('rel');
        el.setAttribute('class', 'mention');
        el.setAttribute('contenteditable', 'false');
        // Drop a chip with a malformed/absent user id.
        const uid = el.getAttribute('data-userid') ?? '';
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid)) {
          const text = document.createTextNode(el.textContent ?? '');
          el.parentNode?.replaceChild(text, el);
          continue;
        }
      } else {
        const href = el.getAttribute('href') ?? '';
        // Drop dangerous protocols.
        if (/^\s*(javascript|data|vbscript):/i.test(href)) {
          el.removeAttribute('href');
        }
        // A non-mention anchor should not carry mention data attrs.
        el.removeAttribute('data-mention');
        el.removeAttribute('data-userid');
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
    }
    walk(el);
  }
}

/** Renders stored rich-text safely. Backwards-compat: if the stored value
 *  doesn't contain any HTML markup (legacy plain-text submissions), it's
 *  rendered as preserved-whitespace text so newlines survive. */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: '\u00a0', amp: '&', lt: '<', gt: '>', quot: '"',
  apos: "'", '#39': "'", ldquo: '\u201c', rdquo: '\u201d',
  lsquo: '\u2018', rsquo: '\u2019', ndash: '\u2013', mdash: '\u2014',
  hellip: '\u2026', trade: '\u2122', copy: '\u00a9', reg: '\u00ae',
};

/**
 * Decode literal HTML entities in a plain-text string to their characters.
 * Pure/string-only (no DOM, no script execution) so it is deterministic and
 * unit-testable. Handles named entities (see table), decimal (&#160;) and hex
 * (&#xA0;) numeric forms. Unknown tokens (e.g. "&D") are left verbatim.
 */
export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try { return String.fromCodePoint(code); } catch { return match; }
      }
      return match;
    }
    const named = NAMED_ENTITIES[body];
    return named !== undefined ? named : match;
  });
}

/** Renders stored rich-text safely. Backwards-compat: if the stored value
 *  doesn't contain any HTML markup (legacy plain-text submissions), it's
 *  rendered as preserved-whitespace text so newlines survive. */
export function renderRichText(stored: string | undefined): { __html: string } {
  if (!stored) return { __html: '' };
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(stored);
  if (!looksLikeHtml) {
    // Stored plain text may hold LITERAL HTML entities (e.g. a migrated/pasted
    // note containing the characters "&nbsp;"). Escaping '&' first would turn
    // that into "&amp;nbsp;", rendered as the visible text "&nbsp;". Decode
    // known entities to real characters FIRST, then escape — so "&nbsp;" becomes
    // a space, while a genuinely-typed ampersand ("R&D", where "&D" is not a
    // valid entity) is preserved and still shows as "R&D".
    // Escape HTML and convert newlines to <br>.
    const escaped = decodeHtmlEntities(stored)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    // Upgrade legacy @[Name](id) canonical tokens into mention chips, then
    // sanitize so old plain-text notes render chips highlighted too.
    const withChips = canonicalMentionsToChips(escaped);
    return { __html: sanitizeRichText(`<div style="white-space:pre-wrap">${withChips}</div>`) };
  }
  // HTML value may still hold legacy canonical tokens inline — upgrade first.
  return { __html: sanitizeRichText(canonicalMentionsToChips(stored)) };
}

/** True when the editor's content is visually empty (just <br> / whitespace). */
export function isRichTextEmpty(html: string | undefined): boolean {
  if (!html) return true;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const txt = (tpl.content.textContent ?? '').trim();
  return txt.length === 0;
}

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** Minimum visible rows (rough; uses min-height in em units). */
  rows?: number;
  className?: string;
}

export function RichTextEditor({ value, onChange, placeholder, rows = 6, className }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);

  // Sync external value into the DOM when it differs from the live editor —
  // but skip when the editor is focused, so we don't lose the caret on every
  // keystroke roundtrip.
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

  function exec(cmd: string, arg?: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, arg);
    // After createLink the browser doesn't tag the new <a> with target/rel —
    // re-sanitize on the way out to enforce.
    if (cmd === 'createLink' && editorRef.current) {
      editorRef.current.innerHTML = sanitizeRichText(editorRef.current.innerHTML);
    }
    emit();
  }

  function handlePaste(e: React.ClipboardEvent) {
    // Paste as PLAIN TEXT only. Rich content from Copilot chats / Outlook
    // emails used to drag in nested spans + inline styles that leaked through
    // as visible markup; keep the words, drop the formatting. Images are
    // captured by the sibling useImagePaste hook (if mounted).
    const text = e.clipboardData.getData('text/plain');
    const html = e.clipboardData.getData('text/html');
    if (!text && !html) return;
    e.preventDefault();
    const insert = (text || htmlToPlainText(html))
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/\r\n?/g, '\n')
      .replace(/\n/g, '<br>');
    document.execCommand('insertHTML', false, insert);
    emit();
  }

  function handleInsertLink() {
    const sel = window.getSelection();
    const hasSelection = !!sel && !sel.isCollapsed && (sel.toString().trim().length > 0);
    const url = window.prompt('Link URL (https://…):');
    if (!url) return;
    if (hasSelection) {
      exec('createLink', url);
    } else {
      // No selection — insert the URL itself as the link text.
      const safe = url.replace(/"/g, '&quot;');
      document.execCommand(
        'insertHTML',
        false,
        `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>&nbsp;`,
      );
      emit();
    }
  }

  const minHeight = `${Math.max(1, rows) * 1.5}rem`;

  return (
    <div className={cn('rounded-md border border-input bg-background overflow-hidden', className)}>
      <div className="flex items-center gap-0.5 px-1 py-1 border-b border-input bg-muted/30">
        <ToolbarButton onClick={() => exec('bold')} title="Bold (Ctrl+B)" icon={<Bold className="h-3.5 w-3.5" />} />
        <ToolbarButton onClick={() => exec('italic')} title="Italic (Ctrl+I)" icon={<Italic className="h-3.5 w-3.5" />} />
        <div className="w-px h-4 bg-border mx-1" aria-hidden />
        <ToolbarButton onClick={() => exec('insertUnorderedList')} title="Bulleted list" icon={<List className="h-3.5 w-3.5" />} />
        <ToolbarButton onClick={() => exec('insertOrderedList')} title="Numbered list" icon={<ListOrdered className="h-3.5 w-3.5" />} />
        <div className="w-px h-4 bg-border mx-1" aria-hidden />
        <ToolbarButton onClick={handleInsertLink} title="Insert link" icon={<Link2 className="h-3.5 w-3.5" />} />
      </div>
      <div
        ref={editorRef}
        contentEditable
        onInput={emit}
        onBlur={emit}
        onPaste={handlePaste}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        className={cn(
          'px-3 py-2 text-sm outline-none [&_a]:text-primary [&_a]:underline',
          // Mention chips: highlighted, not underlined, not a link cursor.
          '[&_a.mention]:no-underline [&_a.mention]:bg-primary/10 [&_a.mention]:text-primary [&_a.mention]:font-medium [&_a.mention]:rounded [&_a.mention]:px-1',
          '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5',
          '[&[data-placeholder]:empty:before]:content-[attr(data-placeholder)]',
          '[&[data-placeholder]:empty:before]:text-muted-foreground',
        )}
        style={{ minHeight }}
      />
    </div>
  );
}

function ToolbarButton({ onClick, title, icon }: { onClick: () => void; title: string; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // keep editor focus when clicking toolbar
      onClick={onClick}
      title={title}
      className="p-1.5 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground"
    >
      {icon}
    </button>
  );
}
