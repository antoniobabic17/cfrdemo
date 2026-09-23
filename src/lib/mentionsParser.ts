/**
 * Mention parsing + rendering.
 *
 * The bulletin composer stores mentions inline in the body using the
 * Markdown-flavored syntax `@[Display Name](systemuserid)`. The pure
 * functions here keep the composer state simple (just one `string`) and
 * let the renderer turn that string into a mix of plain text + clickable
 * chips at display time.
 *
 * No external markdown lib — the syntax is narrow enough that a single
 * regex pass is fast and predictable.
 */
import React from 'react';

const MENTION_RE = /@\[([^\]]+)\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

export interface ParsedMention {
  name: string;
  userId: string;
  /** Character offsets within the source string. */
  start: number;
  end: number;
}

/** Extract every `@[Name](systemuserid)` chip from a serialized body. */
export function extractMentions(body: string): ParsedMention[] {
  const out: ParsedMention[] = [];
  let match: RegExpExecArray | null;
  // Reset lastIndex defensively — RegExp objects with /g are stateful.
  MENTION_RE.lastIndex = 0;
  while ((match = MENTION_RE.exec(body)) !== null) {
    out.push({
      name: match[1],
      userId: match[2],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return out;
}

/** Insert a mention chip at a cursor position. Returns the new body and
 *  the cursor offset to position after the inserted chip. */
export function insertMentionAt(
  body: string,
  cursor: number,
  triggerStart: number,
  mention: { name: string; userId: string },
): { nextBody: string; nextCursor: number } {
  const chip = `@[${mention.name}](${mention.userId}) `;
  const before = body.slice(0, triggerStart);
  const after = body.slice(cursor);
  const nextBody = `${before}${chip}${after}`;
  return { nextBody, nextCursor: before.length + chip.length };
}

/**
 * Convert a canonical body (`@[Name](id)` chips) into a friendly editable
 * string (`@Name`) plus the list of mentions it contained. Used to seed the
 * composer textarea so the user sees "@Frosch, Seth" instead of the raw GUID
 * markup. Later occurrences of an already-seen mention are still listed so
 * re-serialization stays faithful.
 */
export function toFriendlyMentions(body: string): { text: string; mentions: { name: string; userId: string }[] } {
  const mentions = extractMentions(body).map((m) => ({ name: m.name, userId: m.userId }));
  const text = body.replace(MENTION_RE, (_full, name: string) => `@${name}`);
  return { text, mentions };
}

/**
 * Serialize a friendly editable string (`@Name`) back to the canonical
 * `@[Name](id)` form using the known mention set. Longer names are replaced
 * first so a short name that is a prefix of a longer one can't clobber it.
 * Names not in `mentions` are left as plain text.
 */
export function toCanonicalMentions(
  text: string,
  mentions: { name: string; userId: string }[],
): string {
  // De-dupe by name (last id wins) and replace longest-first.
  const byName = new Map<string, string>();
  for (const m of mentions) byName.set(m.name, m.userId);
  const ordered = Array.from(byName.entries()).sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [name, userId] of ordered) {
    // Replace every standalone "@Name" token. The canonical output begins
    // "@[Name]" so it can never be re-matched by a shorter "@Name" literal.
    out = out.split(`@${name}`).join(`@[${name}](${userId})`);
  }
  return out;
}

/**
 * Detect the active `@…` trigger relative to the cursor. Returns the
 * filter text after the `@` and the index of the `@` itself so insert
 * can replace it cleanly. Returns null when there's no open trigger.
 */
export function detectMentionTrigger(
  body: string,
  cursor: number,
): { triggerStart: number; query: string } | null {
  // Walk backwards from the cursor until we hit either an `@`, whitespace,
  // or the start of the string. Only the `@` case opens a trigger.
  let i = cursor - 1;
  while (i >= 0) {
    const ch = body[i];
    if (ch === '@') {
      // The `@` must be at the start or follow whitespace — avoids matching
      // email addresses ("foo@bar").
      const prev = i > 0 ? body[i - 1] : ' ';
      if (/\s/.test(prev) || i === 0) {
        const query = body.slice(i + 1, cursor);
        // Bail out if the query contains a newline or any whitespace — the
        // user has moved past the trigger.
        if (/\s/.test(query)) return null;
        // Also bail if we've already closed a chip — the `]` after the
        // name terminates the trigger.
        if (/[\]()]/.test(query)) return null;
        return { triggerStart: i, query };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
    i--;
  }
  return null;
}

/**
 * Render a serialized body as a list of React nodes — plain text in
 * between, `<MentionChip>` for each chip. The renderer is pure UI; the
 * caller passes the chip component so this file can stay framework-y but
 * style-free.
 */
export function renderBody(
  body: string,
  renderChip: (m: { name: string; userId: string; key: string }) => React.ReactNode,
): React.ReactNode[] {
  const mentions = extractMentions(body);
  if (mentions.length === 0) return [body];

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  mentions.forEach((m, i) => {
    if (m.start > cursor) {
      nodes.push(body.slice(cursor, m.start));
    }
    nodes.push(renderChip({ name: m.name, userId: m.userId, key: `m-${i}` }));
    cursor = m.end;
  });
  if (cursor < body.length) {
    nodes.push(body.slice(cursor));
  }
  return nodes;
}
