/**
 * Note envelope — keeps the Dataverse `annotation.notetext` human-readable in
 * the model-driven Timeline while still storing structured extras (reactions)
 * for the Code App.
 *
 * Unlike the bulletin (which stores a full JSON blob in notetext), a note keeps
 * a PLAIN-TEXT body — with inline `@[Name](systemuserid)` mention chips — and
 * appends a single trailing sentinel line holding a small JSON payload:
 *
 *   <the note body, possibly with @[chips]>
 *   <!--cfrnote:v1 {"reactions":{"👍":["<userid>"]}}-->
 *
 * The sentinel is ALWAYS the last line, so:
 *   - old plain-text notes (no sentinel) decode as body-only, reactions {},
 *   - a body that happens to contain "-->" or "<!--" mid-text is safe because
 *     we only ever parse the final line and only when it matches the exact tag.
 *
 * Parsing is forgiving: a malformed/absent tag is treated as absent (body kept
 * whole, empty reactions) so one bad row never breaks the feed.
 */

export type NoteReactions = Record<string, string[]>;

export interface NoteMeta {
  reactions: NoteReactions;
}

const TAG_OPEN = '<!--cfrnote:v1 ';
const TAG_CLOSE = '-->';

function sanitizeReactions(raw: unknown): NoteReactions {
  if (!raw || typeof raw !== 'object') return {};
  const out: NoteReactions = {};
  for (const [emoji, users] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof emoji !== 'string') continue;
    if (!Array.isArray(users)) continue;
    const ids = users.filter((u): u is string => typeof u === 'string');
    if (ids.length > 0) out[emoji] = ids;
  }
  return out;
}

/**
 * Split a stored notetext into its display body and decoded meta. When no
 * sentinel line is present (plain note), returns the whole string as body with
 * empty reactions.
 */
export function splitNoteMeta(notetext: string | null | undefined): { body: string; meta: NoteMeta } {
  const text = notetext ?? '';
  const lastNewline = text.lastIndexOf('\n');
  const lastLine = lastNewline === -1 ? text : text.slice(lastNewline + 1);
  const trimmed = lastLine.trim();

  if (trimmed.startsWith(TAG_OPEN) && trimmed.endsWith(TAG_CLOSE)) {
    const json = trimmed.slice(TAG_OPEN.length, trimmed.length - TAG_CLOSE.length).trim();
    try {
      const parsed = JSON.parse(json) as { reactions?: unknown };
      const meta: NoteMeta = { reactions: sanitizeReactions(parsed.reactions) };
      const body = lastNewline === -1 ? '' : text.slice(0, lastNewline);
      return { body, meta };
    } catch {
      // Malformed tag — treat the whole string as body.
      return { body: text, meta: { reactions: {} } };
    }
  }
  return { body: text, meta: { reactions: {} } };
}

/**
 * Rebuild a notetext from a plain body + meta. When there are no reactions we
 * emit just the body (no trailing tag) so the note stays pristine in Timeline.
 */
export function joinNoteMeta(body: string, meta: NoteMeta): string {
  const reactions = sanitizeReactions(meta.reactions);
  if (Object.keys(reactions).length === 0) return body;
  const tag = `${TAG_OPEN}${JSON.stringify({ reactions })}${TAG_CLOSE}`;
  return body.length > 0 ? `${body}\n${tag}` : tag;
}

/** Toggle a user's reaction on a reactions map. Pure — returns a new map. */
export function toggleNoteReaction(
  reactions: NoteReactions,
  emoji: string,
  userId: string,
): NoteReactions {
  const current = reactions[emoji] ?? [];
  const has = current.includes(userId);
  const nextUsers = has ? current.filter((u) => u !== userId) : [...current, userId];
  const next = { ...reactions };
  if (nextUsers.length === 0) delete next[emoji];
  else next[emoji] = nextUsers;
  return next;
}

/**
 * Strip the cr87a migration idempotency marker `[[src:<guid>]]` from a note
 * body. The migrator (scripts/migrate-cr87a-project-notes.py) appends this
 * trailing marker to notetext so re-runs can skip already-copied notes; it is
 * internal bookkeeping and must never be shown to users. Removes the marker
 * plus any surrounding blank space, and collapses the trailing whitespace it
 * leaves behind. Safe on notes with no marker (returns the text unchanged).
 *
 * NOTE: this is a DISPLAY-time strip only — the stored notetext keeps the
 * marker until a separate cleanup pass removes it from PROD data.
 */
const SRC_MARKER_RE = /\s*\[\[src:[0-9a-fA-F-]{36}\]\]\s*/g;
export function stripSrcMarker(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(SRC_MARKER_RE, ' ').trim();
}

/**
 * Reduce a stored note body to clean single-line plain text for compact
 * surfaces like the Projects grid "Last Note" column. Strips the src marker,
 * turns legacy canonical mentions `@[Name](id)` into `@Name`, removes any HTML
 * tags (rich body / mention chips render as <div>/<li>/<span> etc.), decodes
 * `&nbsp;`, and collapses whitespace. Mirrors the notePreview strip used in
 * NotesSection so the grid cell reads the same as the note list.
 */
export function notePlainText(text: string | null | undefined): string {
  if (!text) return '';
  return stripSrcMarker(text)
    .replace(/@\[([^\]]+)\]\([^)]*\)/g, '@$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
