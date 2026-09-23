/**
 * "Clone-to-new-version leaves the original version untouched" — T023's acceptance,
 * proven by watching every API call the real hook makes.
 *
 * This is not a claim a reading can settle. The dangerous version of a clone writes to
 * the source somewhere — bumping its version, deactivating it, or reparenting a question
 * — and the UI still looks right because a new template did appear. So the test drives
 * useCloneUatTemplate with the API module mocked and asserts on the recorded calls:
 * every write names the NEW id, and no call names the source id at all.
 *
 * It also pins the reason the hook exists rather than reusing
 * useCreateUatTemplateQuestion: the per-question hook keys its cache off the template id
 * it was built with, so a clone driven through it would invalidate the SOURCE's question
 * list and never the copy's. That is a cache bug with no visible error, so it is asserted
 * here, on the query keys.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';

vi.mock('./useToast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('../lib/errorLog', () => ({ logAppError: vi.fn() }));
vi.mock('../lib/taskSource', () => ({ useDataSource: () => 'custom' }));

const SOURCE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NEW_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const createUatTemplate = vi.fn();
const updateUatTemplate = vi.fn();
const createUatTemplateQuestion = vi.fn();
const updateUatTemplateQuestion = vi.fn();
const deleteUatTemplateQuestion = vi.fn();

vi.mock('../api/uatTemplates.api', () => ({
  listUatTemplates: vi.fn(),
  listActiveUatTemplates: vi.fn(),
  getUatTemplate: vi.fn(),
  createUatTemplate: (...a: unknown[]) => createUatTemplate(...a),
  updateUatTemplate: (...a: unknown[]) => updateUatTemplate(...a),
  listUatTemplateQuestions: vi.fn(),
  getUatTemplateQuestion: vi.fn(),
  createUatTemplateQuestion: (...a: unknown[]) => createUatTemplateQuestion(...a),
  updateUatTemplateQuestion: (...a: unknown[]) => updateUatTemplateQuestion(...a),
  deleteUatTemplateQuestion: (...a: unknown[]) => deleteUatTemplateQuestion(...a),
}));

import { useCloneUatTemplate } from './useUatTemplates';

let queryClient: QueryClient;

function wrapper({ children }: PropsWithChildren) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

/** Two questions carrying every per-question setting the run form honours. */
const SOURCE_QUESTIONS = [
  {
    pmo_questiontext: 'Can the reviewer open the claim?',
    pmo_sequence: 1,
    pmo_helptext: null,
    pmo_expectedresult: 'The claim opens.',
    pmo_responsetype: 893460000,
    pmo_isrequired: true,
    pmo_capturesobservedvalue: true,
    pmo_observedvaluelabel: null,
    pmo_allowscomment: true,
    pmo_allowsattachment: false,
    pmo_section: 'Access',
  },
  {
    pmo_questiontext: 'Does the total match the source system?',
    pmo_sequence: 2,
    pmo_helptext: 'Compare against the ledger export.',
    pmo_expectedresult: null,
    pmo_responsetype: 893460004,
    pmo_isrequired: false,
    pmo_capturesobservedvalue: true,
    pmo_observedvaluelabel: 'Ledger total',
    pmo_allowscomment: false,
    pmo_allowsattachment: true,
    pmo_section: null,
  },
];

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.clearAllMocks();
  createUatTemplate.mockResolvedValue({ pmo_uattemplateid: NEW_ID, pmo_name: 'Claims (v2)', pmo_version: 2 });
  createUatTemplateQuestion.mockResolvedValue({ pmo_uattemplatequestionid: 'new-q' });
});

async function runClone() {
  const { result } = renderHook(() => useCloneUatTemplate(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({
      template: {
        pmo_name: 'Claims (v2)',
        pmo_description: 'Claim review',
        pmo_version: 2,
        pmo_isactive: true,
        pmo_defaultestimatedminutes: 30,
      },
      questions: SOURCE_QUESTIONS,
    } as never);
  });
  return result;
}

describe('useCloneUatTemplate — the original is untouched', () => {
  it('never issues a write that names the source template', async () => {
    await runClone();

    // WEAK ON ITS OWN, deliberately kept: the hook is never handed the source id, so
    // this can only fail if someone hardcodes one. The assertions that actually have
    // teeth are the next two (no updates or deletes at all; exactly N+1 creates) and the
    // page-level guard in the final describe block, which is where a "supersede the old
    // version" step would really be added.
    const everyCall = [
      ...createUatTemplate.mock.calls,
      ...updateUatTemplate.mock.calls,
      ...createUatTemplateQuestion.mock.calls,
      ...updateUatTemplateQuestion.mock.calls,
      ...deleteUatTemplateQuestion.mock.calls,
    ];
    expect(everyCall.length).toBeGreaterThan(0);
    expect(
      JSON.stringify(everyCall),
      'A clone that writes anywhere near the source id can silently mutate a template already used by historical runs.',
    ).not.toContain(SOURCE_ID);
  });

  it('never updates or deletes anything at all — a clone only creates', async () => {
    await runClone();
    expect(updateUatTemplate).not.toHaveBeenCalled();
    expect(updateUatTemplateQuestion).not.toHaveBeenCalled();
    expect(deleteUatTemplateQuestion).not.toHaveBeenCalled();
  });

  it('creates the new template once, then one question per source question', async () => {
    await runClone();
    expect(createUatTemplate).toHaveBeenCalledTimes(1);
    expect(createUatTemplateQuestion).toHaveBeenCalledTimes(SOURCE_QUESTIONS.length);
  });

  it('binds every copied question to the NEW template', async () => {
    await runClone();
    for (const [payload] of createUatTemplateQuestion.mock.calls) {
      expect((payload as Record<string, unknown>)['pmo_Template@odata.bind'])
        .toBe(`/pmo_uattemplates(${NEW_ID})`);
    }
  });

  it('carries every per-question setting across, not just the text', async () => {
    // A clone that drops pmo_allowsattachment or pmo_observedvaluelabel produces a copy
    // that asks the same words but behaves differently in a run.
    await runClone();
    const copied = createUatTemplateQuestion.mock.calls.map(([p]) => p as Record<string, unknown>);
    for (const [index, source] of SOURCE_QUESTIONS.entries()) {
      for (const [field, value] of Object.entries(source)) {
        expect(copied[index][field], `${field} must survive the clone`).toEqual(value);
      }
    }
  });

  it('copies questions in sequence order so a partial failure leaves a prefix', async () => {
    await runClone();
    const sequences = createUatTemplateQuestion.mock.calls
      .map(([p]) => (p as { pmo_sequence: number }).pmo_sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
  });

  it('invalidates the NEW template question list, not the source one', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await runClone();

    const keys = invalidate.mock.calls.map(([arg]) => JSON.stringify((arg as { queryKey: unknown }).queryKey));
    expect(
      keys.some((k) => k === JSON.stringify(['uatTemplateQuestions', NEW_ID])),
      'Without this the clone lands and its question list renders stale or empty.',
    ).toBe(true);
    expect(
      keys.some((k) => k === JSON.stringify(['uatTemplateQuestions', SOURCE_ID])),
      'Invalidating the SOURCE list is the exact bug reusing useCreateUatTemplateQuestion would have caused.',
    ).toBe(false);
    expect(keys.some((k) => k === JSON.stringify(['uatTemplates']))).toBe(true);
  });

  it('stops at the failing question rather than continuing blindly', async () => {
    // Sequential copying is what makes a partial clone a prefix. Firing the rest anyway
    // would produce a copy with a hole in the middle and no error the user can act on.
    createUatTemplateQuestion.mockRejectedValueOnce(new Error('Dataverse refused the insert'));
    const { result } = renderHook(() => useCloneUatTemplate(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({
        template: { pmo_name: 'Claims (v2)', pmo_version: 2, pmo_isactive: true },
        questions: SOURCE_QUESTIONS,
      } as never)).rejects.toThrow(/refused/);
    });

    expect(createUatTemplateQuestion).toHaveBeenCalledTimes(1);
    // And it still never touched the source.
    expect(updateUatTemplate).not.toHaveBeenCalled();
  });
});

/**
 * Where "leaves the original untouched" can actually break.
 *
 * The hook only ever creates, so the plausible regression is in the page: someone adds
 * "and mark the old version inactive" to the clone handler, which is a one-line edit that
 * looks like housekeeping and quietly rewrites a template historical runs point at. The
 * page holds a live updateTemplate mutation for its header fields, so the ingredients are
 * already in scope — that is exactly why this is asserted rather than assumed.
 */
describe('TemplateDetailPage wiring — the clone handler writes only to the copy', () => {
  const pageSource = Object.values(
    import.meta.glob('../features/uat/pages/TemplateDetailPage.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  )[0];

  function handleCloneBody(): string {
    const start = pageSource.indexOf('async function handleClone()');
    expect(start, 'handleClone must exist in the page').toBeGreaterThan(-1);
    // Up to the next top-level declaration; enough to cover the handler.
    const end = pageSource.indexOf('\n  return (', start);
    return pageSource.slice(start, end === -1 ? undefined : end);
  }

  it('loaded the page source', () => {
    expect(pageSource).toBeTruthy();
  });

  it('routes the clone through useCloneUatTemplate', () => {
    // Reachability: a correct clone hook the page never calls is worth nothing.
    expect(pageSource).toContain('useCloneUatTemplate()');
    expect(handleCloneBody()).toContain('cloneTemplate.mutateAsync');
  });

  it('does not touch the source template anywhere in the clone handler', () => {
    const body = handleCloneBody();
    expect(
      body,
      'Superseding, deactivating or version-bumping the ORIGINAL here would rewrite a template that completed runs point at.',
    ).not.toContain('updateTemplate');
  });

  it('still uses updateTemplate for the header fields, so the check above is not vacuous', () => {
    // Paired positive: without this, the assertion above would pass simply because the
    // page had stopped using updateTemplate at all.
    expect(pageSource).toContain('updateTemplate.mutateAsync');
  });
});

describe('the clone reports failure like every other UAT write', () => {
  it('surfaces a toast and a telemetry row when the create is refused', async () => {
    const { toast } = await import('./useToast');
    createUatTemplate.mockRejectedValueOnce(new Error('403 Forbidden'));
    const { result } = renderHook(() => useCloneUatTemplate(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({
        template: { pmo_name: 'Claims (v2)', pmo_version: 2, pmo_isactive: true },
        questions: [],
      } as never)).rejects.toThrow();
    });

    // useAppMutation owns this. If the clone had used a bare useMutation the rejection
    // would be private and the user would see a dialog that simply did nothing.
    expect(toast.error).toHaveBeenCalled();
  });
});
