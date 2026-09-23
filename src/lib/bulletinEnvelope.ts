/**
 * Bulletin post envelope — encoded inside annotation.notetext.
 *
 * Each bulletin post is one annotation row whose `notetext` carries a JSON
 * blob with the post body, mentions, reactions, and optional GIF. The
 * annotation `subject` carries a routing tag:
 *   - 'bulletin:v1'                        → top-level post
 *   - 'bulletin:v1:reply:{parentAnnId}'   → reply nested under a top-level
 *
 * Wrapping everything in one JSON column keeps reactions + mentions + GIFs
 * inline without four new custom tables. The parser is forgiving — any
 * malformed row falls back to an empty default so a single bad post does
 * not crash the feed.
 */

export const SUBJECT_PREFIX = 'bulletin:v1';
const REPLY_TAG = ':reply:';

export interface MentionRef {
  userId: string;
  name: string;
}

export interface BulletinPayload {
  /** Schema version — bumped if the JSON shape ever changes. */
  v: 1;
  /** Plain text with `@[Name](systemuserid)` mention chips inline. */
  body: string;
  /** Resolved mention metadata for notification + display. */
  mentions: MentionRef[];
  /** Tenor GIF URL (full-resolution) attached to the post. */
  gifUrl?: string;
  /** emoji → array of systemuserids who reacted with that emoji. */
  reactions: Record<string, string[]>;
}

export const DEFAULT_PAYLOAD: BulletinPayload = {
  v: 1,
  body: '',
  mentions: [],
  reactions: {},
};

// ── Subject helpers ─────────────────────────────────────────────────────────

export function topLevelSubject(): string {
  return SUBJECT_PREFIX;
}

export function replySubject(parentAnnotationId: string): string {
  // annotation.subject hard cap is 500 — well above our worst case
  // ('bulletin:v1:reply:' + 36-char GUID = ~55 chars).
  return `${SUBJECT_PREFIX}${REPLY_TAG}${parentAnnotationId}`;
}

/**
 * Pulls the parent annotation id from a reply's subject. Returns undefined
 * for top-level posts (or any non-bulletin subject). Forgiving.
 */
export function parseParentAnnotationId(subject: string | undefined): string | undefined {
  if (!subject) return undefined;
  if (!subject.startsWith(`${SUBJECT_PREFIX}${REPLY_TAG}`)) return undefined;
  const id = subject.slice((SUBJECT_PREFIX + REPLY_TAG).length).trim();
  return id || undefined;
}

export function isBulletinSubject(subject: string | undefined): boolean {
  return !!subject && subject.startsWith(SUBJECT_PREFIX);
}

// ── Payload encode / decode ─────────────────────────────────────────────────

export function encode(payload: BulletinPayload): string {
  // Stringify with stable key order so equality checks (e.g. dedupe on
  // re-render) are deterministic.
  return JSON.stringify({
    v: payload.v,
    body: payload.body,
    mentions: payload.mentions,
    gifUrl: payload.gifUrl,
    reactions: payload.reactions,
  });
}

export function decode(notetext: string | null | undefined): BulletinPayload {
  if (!notetext) return { ...DEFAULT_PAYLOAD };
  try {
    const raw = JSON.parse(notetext) as Partial<BulletinPayload>;
    return {
      v: 1,
      body: typeof raw.body === 'string' ? raw.body : '',
      mentions: Array.isArray(raw.mentions)
        ? raw.mentions.filter((m): m is MentionRef =>
            !!m && typeof (m as MentionRef).userId === 'string' && typeof (m as MentionRef).name === 'string',
          )
        : [],
      gifUrl: typeof raw.gifUrl === 'string' ? raw.gifUrl : undefined,
      reactions: raw.reactions && typeof raw.reactions === 'object'
        ? Object.fromEntries(
            Object.entries(raw.reactions).filter(
              ([emoji, users]) =>
                typeof emoji === 'string' &&
                Array.isArray(users) &&
                users.every((u) => typeof u === 'string'),
            ) as [string, string[]][],
          )
        : {},
    };
  } catch {
    return { ...DEFAULT_PAYLOAD };
  }
}

/** Toggle a user's reaction on a post payload. Pure — returns a new object. */
export function toggleReaction(
  payload: BulletinPayload,
  emoji: string,
  userId: string,
): BulletinPayload {
  const current = payload.reactions[emoji] ?? [];
  const has = current.includes(userId);
  const nextUsers = has ? current.filter((u) => u !== userId) : [...current, userId];
  const nextReactions = { ...payload.reactions };
  if (nextUsers.length === 0) {
    delete nextReactions[emoji];
  } else {
    nextReactions[emoji] = nextUsers;
  }
  return { ...payload, reactions: nextReactions };
}
