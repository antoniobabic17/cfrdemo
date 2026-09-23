/**
 * T023's acceptance, driven against the real editor.
 *
 * Two claims are load-bearing and neither is provable by reading the component:
 *
 * 1. FINDING 31'S NULLS RENDER HONESTLY. Ten of the thirteen seeded questions have no
 *    pmo_section and all thirteen have no pmo_observedvaluelabel. The failure mode is
 *    not a crash — it is a heading that reads "null", or an invented section name that
 *    looks plausible and is wrong. So the fixture below is deliberately shaped like the
 *    real seed, and the test asserts the literal string "null" never reaches the DOM.
 *
 * 2. EVERY PER-QUESTION SETTING THE RUN FORM HONOURS IS EDITABLE. The acceptance names
 *    five: required, captures-observed-value with its label, allows-comment,
 *    allows-attachment, and section. A missing control here is not a cosmetic gap — it
 *    is a setting the run form reads that nobody can ever change, which is the exact
 *    class of problem this rebuild exists to remove. Asserting each control by its
 *    accessible label is what makes that checkable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { UatTemplateQuestion } from '../../../models/uatTemplate.model';
import { UAT_RESPONSE_TYPE } from '../../../lib/uatOptionSets';

const TEMPLATE_ID = '77777777-7777-7777-7777-777777777777';

let mockQuestions: UatTemplateQuestion[] = [];
let mockState = { isLoading: false, isError: false };
const mutateAsync = vi.fn(() => Promise.resolve(undefined as never));

function stubMutation() {
  return { mutateAsync, isPending: false };
}

vi.mock('../../../hooks/useUatTemplates', () => ({
  useUatTemplateQuestions: () => ({
    data: mockQuestions,
    isLoading: mockState.isLoading,
    isError: mockState.isError,
    refetch: vi.fn(),
  }),
  useCreateUatTemplateQuestion: () => stubMutation(),
  useUpdateUatTemplateQuestion: () => stubMutation(),
  useDeleteUatTemplateQuestion: () => stubMutation(),
  useReorderUatTemplateQuestions: () => stubMutation(),
}));

import { TemplateQuestionEditor } from './TemplateQuestionEditor';
import {
  groupQuestionsBySection,
  UNGROUPED_SECTION_LABEL,
  DEFAULT_OBSERVED_VALUE_LABEL,
} from '../lib/questionGrouping';

function question(overrides: Partial<UatTemplateQuestion> & { pmo_sequence: number }): UatTemplateQuestion {
  return {
    pmo_uattemplatequestionid: `q-${overrides.pmo_sequence}`,
    pmo_questiontext: `Question ${overrides.pmo_sequence}`,
    pmo_helptext: null,
    pmo_expectedresult: null,
    pmo_responsetype: UAT_RESPONSE_TYPE.Choice,
    pmo_isrequired: true,
    pmo_capturesobservedvalue: true,
    // Both null on the real seed. See finding 31.
    pmo_observedvaluelabel: null,
    pmo_allowscomment: true,
    pmo_allowsattachment: true,
    pmo_section: null,
    ...overrides,
  } as UatTemplateQuestion;
}

/**
 * Shaped like the seeded template as it actually stands in DEV, read back 2026-08-29:
 * thirteen questions, ten with a null pmo_section, and all thirteen with a null
 * pmo_observedvaluelabel. Questions 1, 2 and 13 carry a section; 3-12 do not.
 *
 * The section name is a placeholder — the real ones are among the values finding 27
 * leaves with the owner, so inventing them here would be inventing product content. The
 * SHAPE is what matters to these tests, and the shape is measured.
 */
function seedShapedQuestions(): UatTemplateQuestion[] {
  return [
    question({ pmo_sequence: 1, pmo_section: 'Access' }),
    question({ pmo_sequence: 2, pmo_section: 'Access' }),
    ...Array.from({ length: 10 }, (_, i) => question({ pmo_sequence: i + 3 })),
    question({ pmo_sequence: 13, pmo_section: 'Access' }),
  ];
}

beforeEach(() => {
  mockQuestions = seedShapedQuestions();
  mockState = { isLoading: false, isError: false };
  mutateAsync.mockClear();
});

/**
 * The literals themselves, pinned.
 *
 * Every other assertion in this file compares against UNGROUPED_SECTION_LABEL and
 * DEFAULT_OBSERVED_VALUE_LABEL rather than a string, which made them self-referential:
 * measured 2026-08-29, renaming the bucket to 'General Validation' left all sixteen
 * tests green. That rename is exactly what finding 31 forbids — an invented heading that
 * reads like a section the owner chose. So the values are pinned here, and the rest of
 * the file can keep using the constants.
 */
describe('the fallback labels are neutral, not invented product content', () => {
  it('names the unsectioned bucket "Ungrouped" and nothing more specific', () => {
    expect(
      UNGROUPED_SECTION_LABEL,
      'A domain-sounding heading here would read as a section the owner authored. Ten seeded questions have no section and the owner has not supplied one (finding 31).',
    ).toBe('Ungrouped');
  });

  it('falls back to a generic observed-value prompt', () => {
    expect(
      DEFAULT_OBSERVED_VALUE_LABEL,
      'pmo_observedvaluelabel is null on all thirteen seeded questions; the label must stay generic until the owner supplies the real ones.',
    ).toBe('Observed value');
  });
});

describe('groupQuestionsBySection — finding 31, as a pure function', () => {
  it('buckets a null section under Ungrouped rather than under "null"', () => {
    const groups = groupQuestionsBySection([question({ pmo_sequence: 1 })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].section).toBe(UNGROUPED_SECTION_LABEL);
    expect(groups[0].isUngrouped).toBe(true);
  });

  it('treats an empty and a whitespace-only section the same as null', () => {
    // A blanked-out text input sends '' rather than null, and a stray space is invisible
    // to the person who typed it. All three mean "no section".
    const groups = groupQuestionsBySection([
      question({ pmo_sequence: 1, pmo_section: '' }),
      question({ pmo_sequence: 2, pmo_section: '   ' }),
      question({ pmo_sequence: 3, pmo_section: null }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].section).toBe(UNGROUPED_SECTION_LABEL);
    expect(groups[0].questions).toHaveLength(3);
  });

  it('keeps real section names and never invents one', () => {
    const groups = groupQuestionsBySection(seedShapedQuestions());
    expect(groups.map((g) => g.section)).toEqual(['Access', UNGROUPED_SECTION_LABEL]);
    // Matches DEV: three sectioned, ten not. The ten must not be absorbed into 'Access'.
    expect(groups[0].questions).toHaveLength(3);
    expect(groups[1].questions).toHaveLength(10);
  });

  it('puts Ungrouped last so named sections are not buried', () => {
    const groups = groupQuestionsBySection([
      question({ pmo_sequence: 1 }),
      question({ pmo_sequence: 2, pmo_section: 'Reporting' }),
    ]);
    expect(groups[groups.length - 1].isUngrouped).toBe(true);
  });

  it('omits the Ungrouped bucket entirely when every question has a section', () => {
    const groups = groupQuestionsBySection([question({ pmo_sequence: 1, pmo_section: 'Access' })]);
    expect(groups.some((g) => g.isUngrouped)).toBe(false);
  });
});

describe('TemplateQuestionEditor — what a person actually sees', () => {
  it('renders the Ungrouped heading and never the word null', () => {
    const { container } = render(<TemplateQuestionEditor templateId={TEMPLATE_ID} canEdit />);
    expect(screen.getByRole('heading', { name: UNGROUPED_SECTION_LABEL })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Access' })).toBeTruthy();
    // The failure this guards is a heading or field value reading "null" / "undefined".
    expect(container.textContent).not.toMatch(/\bnull\b/i);
    expect(container.textContent).not.toMatch(/\bundefined\b/i);
  });

  it('explains that the Ungrouped bucket is missing data, not a real section', () => {
    // Otherwise "Ungrouped" reads as a section someone chose, and nobody fixes it.
    render(<TemplateQuestionEditor templateId={TEMPLATE_ID} canEdit />);
    expect(screen.getByText(/no section recorded/i)).toBeTruthy();
  });

  it('offers a generic observed-value label instead of inventing one', () => {
    render(<TemplateQuestionEditor templateId={TEMPLATE_ID} canEdit />);
    const field = screen.getAllByLabelText(/observed-value label/i)[0] as HTMLInputElement;
    // Empty value, generic placeholder: the gap is visible and fillable, not papered over.
    expect(field.value).toBe('');
    expect(field.getAttribute('placeholder')).toContain(DEFAULT_OBSERVED_VALUE_LABEL);
  });

  it('exposes an editable control for EVERY per-question setting in the acceptance', () => {
    render(<TemplateQuestionEditor templateId={TEMPLATE_ID} canEdit />);
    const firstQuestion = screen.getAllByRole('listitem')[0];
    const scope = within(firstQuestion);

    // Named in T023's acceptance, one assertion each so a removal names itself.
    expect(scope.getByLabelText(/^Question/)).toBeTruthy();
    expect(scope.getByLabelText(/answer type/i)).toBeTruthy();
    expect(scope.getByLabelText(/^Section$/)).toBeTruthy();
    expect(scope.getByLabelText(/observed-value label/i)).toBeTruthy();
    for (const setting of ['Required', 'Captures observed value', 'Allows comment', 'Allows attachment']) {
      expect(scope.getByLabelText(setting), `${setting} must be editable here`).toBeTruthy();
    }
  });

  it('labels the answer type from the generated registry, not a hand-written string', () => {
    render(<TemplateQuestionEditor templateId={TEMPLATE_ID} canEdit />);
    // The fixture sets UAT_RESPONSE_TYPE.Choice, so 'Choice' can only appear if the label
    // came from UAT_RESPONSE_TYPE_LABELS. A hand-written label could drift from Dataverse
    // silently. (No integer is written out here — G-OPTINT scans comments too, correctly:
    // a literal in a comment is how a stale value spreads.)
    expect(screen.getAllByText('Choice').length).toBeGreaterThan(0);
  });

  it('offers a way to add a question — the whole point of user story 1', () => {
    render(<TemplateQuestionEditor templateId={TEMPLATE_ID} canEdit />);
    expect(screen.getByLabelText(/add a question/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Add$/ })).toBeTruthy();
  });

  it('offers reorder controls on every question', () => {
    render(<TemplateQuestionEditor templateId={TEMPLATE_ID} canEdit />);
    expect(screen.getAllByRole('button', { name: /move .* earlier/i })).toHaveLength(13);
    expect(screen.getAllByRole('button', { name: /move .* later/i })).toHaveLength(13);
  });

  it('does not delete without confirming intent', () => {
    render(<TemplateQuestionEditor templateId={TEMPLATE_ID} canEdit />);
    // The delete affordance exists, but no destructive call has been issued by rendering
    // it — the confirmation dialog stands between the two.
    expect(screen.getAllByRole('button', { name: /^Delete /i }).length).toBe(13);
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByText(/delete this question\?/i)).toBeNull();
  });

  it('distinguishes a failed load from an empty template', () => {
    // DataTable-style "no records" on a failed query reads as "this template has no
    // questions", which is a different and much more alarming statement.
    mockState = { isLoading: false, isError: true };
    render(<TemplateQuestionEditor templateId={TEMPLATE_ID} canEdit />);
    expect(screen.getByText(/could not be loaded/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('shows a real empty state when the template genuinely has no questions', () => {
    mockQuestions = [];
    render(<TemplateQuestionEditor templateId={TEMPLATE_ID} canEdit />);
    expect(screen.getByText(/no questions yet/i)).toBeTruthy();
  });

  it('disables every editing control when canEdit is false', () => {
    // The paired positive case for the guard: without it, "read-only works" would pass
    // simply because nothing was rendered.
    render(<TemplateQuestionEditor templateId={TEMPLATE_ID} canEdit={false} />);
    const required = screen.getAllByLabelText('Required')[0] as HTMLInputElement;
    expect(required.disabled).toBe(true);
    expect(screen.queryByLabelText(/add a question/i)).toBeNull();
  });
});
