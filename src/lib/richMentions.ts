/**
 * richMentions — bridge between the mention model and the unified rich-text
 * composer (RichNoteEditor), whose stored value is sanitized HTML.
 *
 * A mention inside rich HTML is a single non-editable anchor chip:
 *   <a data-mention="1" data-userid="<systemuserid>" class="mention">@Name</a>
 *
 * These helpers:
 *   - build that chip element markup (buildMentionChip)
 *   - pull the mentioned user ids out of an HTML string (extractMentionUserIds),
 *     used to fire notifications on save
 *   - stay BACKWARD-COMPATIBLE with the legacy canonical `@[Name](id)` form that
 *     older notes / admin responses stored as plain text, and with the friendly
 *     `@Name` form — so a value written before this feature still yields its
 *     mention ids.
 *
 * GUID shape reused from mentionsParser (systemuser id).
 */

const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// Canonical text mention (legacy): @[Name](guid)
const CANONICAL_RE = new RegExp(`@\\[([^\\]]+)\\]\\((${GUID})\\)`, 'gi');
// HTML mention chip: <a ... data-userid="guid" ...>@Name</a> (attr order-agnostic)
const CHIP_USERID_RE = new RegExp(`data-userid=["'](${GUID})["']`, 'gi');

/** HTML for a non-editable mention chip. Name is HTML-escaped. */
export function buildMentionChip(name: string, userId: string): string {
  const safeName = escapeHtml(name);
  const safeId = userId.toLowerCase();
  return `<a data-mention="1" data-userid="${safeId}" class="mention" contenteditable="false">@${safeName}</a>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Return the DISTINCT mentioned user ids (lower-case) found in a value, whether
 * the value is rich HTML (chip anchors), legacy canonical `@[Name](id)` text, or
 * a mix. Used to fire mention notifications on save.
 */
export function extractMentionUserIds(value: string | null | undefined): string[] {
  if (!value) return [];
  const ids = new Set<string>();
  let m: RegExpExecArray | null;
  CHIP_USERID_RE.lastIndex = 0;
  while ((m = CHIP_USERID_RE.exec(value)) !== null) ids.add(m[1].toLowerCase());
  CANONICAL_RE.lastIndex = 0;
  while ((m = CANONICAL_RE.exec(value)) !== null) ids.add(m[2].toLowerCase());
  return [...ids];
}

/**
 * Upgrade any legacy canonical `@[Name](id)` tokens embedded in an HTML/text
 * value into HTML mention chips, so a value authored before this feature renders
 * as chips in the new editor/renderer. Values with no canonical tokens are
 * returned unchanged. Does NOT touch existing chip anchors.
 */
export function canonicalMentionsToChips(value: string | null | undefined): string {
  if (!value) return '';
  CANONICAL_RE.lastIndex = 0;
  return value.replace(CANONICAL_RE, (_full, name: string, id: string) =>
    buildMentionChip(name, id),
  );
}
