/**
 * Task labels stored as a single text field (pmo_task.pmo_tasklabel) on the
 * custom source, so users can create their own labels without a shared
 * msdyn_projectlabel dependency (that table is Microsoft-locked / PSS-gated).
 *
 * Wire format:  name:#hexcolor;name:#hexcolor;...
 *   e.g.  "Urgent:#e11d48;Blocked:#f59e0b;UX Review:#8b5cf6"
 *
 * - Multiple labels per task, ';'-separated; each is `name:#color`.
 * - Names are sanitized (';' and ':' stripped, trimmed) so the delimiters stay
 *   unambiguous; empty names are dropped.
 * - Colors default to a neutral hex when missing/invalid.
 * - Dedupe is by case-insensitive name (last color wins).
 * - Queryable server-side via contains(pmo_tasklabel, 'Name:').
 *
 * All functions are pure -- unit tested in taskLabelText.test.ts.
 */

export interface TaskLabel {
  name: string;
  color: string; // '#rrggbb'
}

const SEP = ';';
const KV = ':';
const DEFAULT_COLOR = '#64748b'; // slate-500

/** Strip delimiter chars + trim. Returns '' for nullish. */
export function sanitizeLabelName(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/[;:]/g, '').trim();
}

/** Normalize a color to '#rrggbb'; falls back to the default when invalid. */
export function sanitizeColor(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_COLOR;
  const v = raw.trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : DEFAULT_COLOR;
}

/** Parse the stored text into a label list. Tolerant of blanks/whitespace. */
export function parseTaskLabels(text: string | null | undefined): TaskLabel[] {
  if (!text) return [];
  const out: TaskLabel[] = [];
  const seen = new Set<string>();
  for (const chunk of text.split(SEP)) {
    if (!chunk.trim()) continue;
    const idx = chunk.indexOf(KV);
    const namePart = idx >= 0 ? chunk.slice(0, idx) : chunk;
    const colorPart = idx >= 0 ? chunk.slice(idx + 1) : '';
    const name = sanitizeLabelName(namePart);
    if (!name) continue;
    const key = name.toLowerCase();
    const color = sanitizeColor(colorPart);
    if (seen.has(key)) {
      // last color wins — update the existing entry
      const existing = out.find((l) => l.name.toLowerCase() === key);
      if (existing) existing.color = color;
      continue;
    }
    seen.add(key);
    out.push({ name, color });
  }
  return out;
}

/** Serialize a label list back to the stored text form. */
export function serializeTaskLabels(labels: TaskLabel[]): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of labels) {
    const name = sanitizeLabelName(l.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`${name}${KV}${sanitizeColor(l.color)}`);
  }
  return out.join(SEP);
}

/** Add (or update the color of) a label. Returns the new text. Idempotent by name. */
export function addTaskLabel(text: string | null | undefined, name: string, color?: string): string {
  const clean = sanitizeLabelName(name);
  if (!clean) return text ?? '';
  const labels = parseTaskLabels(text);
  const key = clean.toLowerCase();
  const existing = labels.find((l) => l.name.toLowerCase() === key);
  if (existing) {
    if (color) existing.color = sanitizeColor(color);
  } else {
    labels.push({ name: clean, color: sanitizeColor(color) });
  }
  return serializeTaskLabels(labels);
}

/** Remove a label by (case-insensitive) name. Returns the new text. */
export function removeTaskLabel(text: string | null | undefined, name: string): string {
  const key = sanitizeLabelName(name).toLowerCase();
  if (!key) return text ?? '';
  return serializeTaskLabels(parseTaskLabels(text).filter((l) => l.name.toLowerCase() !== key));
}

/** Rename a label in place, preserving its color + position. Returns the new text. */
export function renameTaskLabel(text: string | null | undefined, oldName: string, newName: string): string {
  const oldKey = sanitizeLabelName(oldName).toLowerCase();
  const clean = sanitizeLabelName(newName);
  if (!oldKey || !clean) return text ?? '';
  const labels = parseTaskLabels(text);
  const target = labels.find((l) => l.name.toLowerCase() === oldKey);
  if (!target) return serializeTaskLabels(labels);
  // If the new name collides with a different existing label, merge (drop dup).
  const collision = labels.find((l) => l !== target && l.name.toLowerCase() === clean.toLowerCase());
  target.name = clean;
  const merged = collision ? labels.filter((l) => l !== collision) : labels;
  return serializeTaskLabels(merged);
}
