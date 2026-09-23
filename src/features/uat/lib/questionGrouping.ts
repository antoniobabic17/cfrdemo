/**
 * How a template's questions are grouped and how their missing labels read.
 *
 * SHARED ON PURPOSE. These are not editor details — the run form (Phase 5) shows the same
 * questions to a tester and must group and label them identically, or the person authoring
 * a template and the person answering it see two different documents. Keeping the rule in
 * one module is what makes that structural rather than remembered.
 *
 * FINDING 31 IS THE REASON THIS EXISTS. Ten of the thirteen seeded questions have no
 * pmo_section and all thirteen have no pmo_observedvaluelabel; the source plan does not
 * supply either, and the owner has not authorised the one PROD read that would recover
 * them. So the gap must render as a gap: a neutral bucket and a generic prompt. Inventing
 * a heading that reads like a section someone chose is the failure this module prevents —
 * it would be indistinguishable from real data.
 */
import type { UatTemplateQuestion } from '../../../models/uatTemplate.model';

/**
 * Shown where a question has no pmo_section.
 *
 * Deliberately neutral and deliberately not a domain term. Pinned by a test: a rename to
 * anything that reads like a real section name is a finding-31 violation.
 */
export const UNGROUPED_SECTION_LABEL = 'Ungrouped';

/**
 * Shown where pmo_observedvaluelabel is null. Generic for the same reason.
 *
 * The editor uses it as the placeholder that tells an author what a blank field will
 * produce. Phase 5's run form is the other consumer and will read it directly; no
 * resolver helper is exported ahead of that call site.
 */
export const DEFAULT_OBSERVED_VALUE_LABEL = 'Observed value';

export interface GroupedQuestions {
  section: string;
  /** True when this is the synthetic bucket, not a section from the data. */
  isUngrouped: boolean;
  questions: UatTemplateQuestion[];
}

/**
 * Group questions by section, unsectioned ones last under a synthetic heading.
 *
 * Empty and whitespace-only sections are treated as absent: a blanked-out text input
 * sends '' rather than null, and a stray space is invisible to whoever typed it.
 */
export function groupQuestionsBySection(
  questions: readonly UatTemplateQuestion[],
): GroupedQuestions[] {
  const named = new Map<string, UatTemplateQuestion[]>();
  const ungrouped: UatTemplateQuestion[] = [];

  for (const question of questions) {
    const section = question.pmo_section?.trim();
    if (!section) {
      ungrouped.push(question);
      continue;
    }
    const bucket = named.get(section);
    if (bucket) bucket.push(question);
    else named.set(section, [question]);
  }

  const groups: GroupedQuestions[] = [...named.entries()].map(([section, qs]) => ({
    section,
    isUngrouped: false,
    questions: qs,
  }));

  if (ungrouped.length > 0) {
    // Last, so a partially-sectioned template reads as "the known sections, then the
    // rest" rather than burying named sections under a placeholder.
    groups.push({ section: UNGROUPED_SECTION_LABEL, isUngrouped: true, questions: ungrouped });
  }
  return groups;
}
