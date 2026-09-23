/**
 * T025's two invariants, driven through the real hooks.
 *
 * 1. THE NEW CASE APPEARS WITHOUT A MANUAL REFRESH. The acceptance says so in those
 *    words. The mechanism is the create mutation invalidating the project's list query,
 *    and the failure mode is silent: the write succeeds, the toast says so, and the list
 *    the user is looking at still does not contain the row. Nothing else in the app would
 *    fail. So this seeds a real QueryClient with a real list cache and asserts the entry
 *    is invalidated after the write.
 *
 * 2. RE-PARENTING IS REFUSED, NOT DOCUMENTED. pmo_uattestrun.pmo_project is the model's
 *    one denormalization — a copy of the case's project kept so run-level reporting needs
 *    no join. data-model.md §4.2 says that if a case is ever re-parented its runs' copy
 *    must move with it, and T025's acceptance says leaving that invariant implicit is not
 *    acceptable. It is enforced by stripping the project binds in both update hooks, so
 *    the two references cannot be driven apart by a caller who has not read the data
 *    model. Asserted in BOTH directions: a bind is removed, and everything else on the
 *    same payload still lands. A guard that quietly dropped the whole payload would pass
 *    a one-sided test.
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
vi.mock('../lib/taskSource', () => ({
  useDataSource: () => 'custom',
  usesCustomTables: (s: string) => s === 'custom' || s === 'sharepoint',
}));

const createUatTestCase = vi.fn();
const updateUatTestCase = vi.fn();
vi.mock('../api/uatTestCases.api', () => ({
  listUatTestCasesByProject: vi.fn(),
  listUatTestCasesByCycle: vi.fn(),
  getUatTestCase: vi.fn(),
  createUatTestCase: (...args: unknown[]) => createUatTestCase(...args),
  updateUatTestCase: (...args: unknown[]) => updateUatTestCase(...args),
  deleteUatTestCase: vi.fn(),
  listCoverageForRequirement: vi.fn(),
  listCoverageForTestCase: vi.fn(),
  createUatCoverageLink: vi.fn(),
  updateUatCoverageLink: vi.fn(),
  deleteUatCoverageLink: vi.fn(),
  listUatTags: vi.fn(),
  createUatTag: vi.fn(),
  listUatTagLinksForTestCase: vi.fn(),
}));

const updateUatTestRun = vi.fn();
vi.mock('../api/uatTestRuns.api', () => ({
  listUatCyclesByProject: vi.fn(),
  getUatCycle: vi.fn(),
  createUatCycle: vi.fn(),
  updateUatCycle: vi.fn(),
  deleteUatCycle: vi.fn(),
  listUatTestRunsByTestCase: vi.fn(),
  listCurrentUatTestRun: vi.fn(),
  getUatTestRun: vi.fn(),
  createUatTestRun: vi.fn(),
  updateUatTestRun: (...args: unknown[]) => updateUatTestRun(...args),
  listUatTestRunAnswers: vi.fn(),
  createUatTestRunAnswer: vi.fn(),
  updateUatTestRunAnswer: vi.fn(),
}));

import { useCreateUatTestCase, useUpdateUatTestCase } from './useUatTestCases';
import { useUpdateUatTestRun } from './useUatTestRuns';
import { PSS_PROJECT_BIND, CUSTOM_PROJECT_BIND } from '../lib/projectLookupRef';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_PROJECT_ID = '22222222-2222-2222-2222-222222222222';
const CASE_ID = '33333333-3333-3333-3333-333333333333';
const RUN_ID = '44444444-4444-4444-4444-444444444444';
const CASES_QK = ['uatTestCases', PROJECT_ID];
// Mirrors the module's reserved segment. A wrong key here would assert nothing and pass.
const ALL_CASES_QK = ['uatTestCases', '__all__'];

function harness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a created test case appears without a manual refresh (T025)', () => {
  it('invalidates the project’s test-case list after the write', async () => {
    createUatTestCase.mockResolvedValue({ pmo_uattestcaseid: CASE_ID });
    const { qc, wrapper } = harness();
    // A list the user is already looking at.
    qc.setQueryData(CASES_QK, [{ pmo_uattestcaseid: 'existing' }]);
    expect(qc.getQueryState(CASES_QK)?.isInvalidated).toBe(false);

    const { result } = renderHook(() => useCreateUatTestCase(PROJECT_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ pmo_title: 'Probe case' });
    });

    expect(
      qc.getQueryState(CASES_QK)?.isInvalidated,
      'the list the user is looking at must be refetched, not left stale',
    ).toBe(true);
  });

  it('invalidates the CROSS-PROJECT list too, so the two surfaces cannot disagree', async () => {
    // The project tab and the UAT overview show the same rows through one shared grid.
    // Refreshing one and not the other leaves the overview confidently stale — the
    // like-surface parity contract applied to cache freshness rather than to features.
    createUatTestCase.mockResolvedValue({ pmo_uattestcaseid: CASE_ID });
    const { qc, wrapper } = harness();
    qc.setQueryData(ALL_CASES_QK, [{ pmo_uattestcaseid: 'existing' }]);

    const { result } = renderHook(() => useCreateUatTestCase(PROJECT_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ pmo_title: 'Probe case' });
    });

    expect(qc.getQueryState(ALL_CASES_QK)?.isInvalidated).toBe(true);
  });

  it('binds the project it was given, so the caller cannot create into another one', async () => {
    createUatTestCase.mockResolvedValue({ pmo_uattestcaseid: CASE_ID });
    const { wrapper } = harness();
    const { result } = renderHook(() => useCreateUatTestCase(PROJECT_ID), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        pmo_title: 'Probe case',
        // A caller aiming somewhere else.
        [CUSTOM_PROJECT_BIND]: `/pmo_projects(${OTHER_PROJECT_ID})`,
      });
    });

    const payload = createUatTestCase.mock.calls[0][0] as Record<string, unknown>;
    expect(JSON.stringify(payload)).not.toContain(OTHER_PROJECT_ID);
    expect(JSON.stringify(payload)).toContain(PROJECT_ID);
    expect(payload.pmo_title).toBe('Probe case');
  });
});

describe('re-parenting a test case is refused (T025 / data-model.md §4.2)', () => {
  it('strips both halves of the project reference from an update', async () => {
    updateUatTestCase.mockResolvedValue({ pmo_uattestcaseid: CASE_ID });
    const { wrapper } = harness();
    const { result } = renderHook(() => useUpdateUatTestCase(PROJECT_ID), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: CASE_ID,
        payload: {
          pmo_title: 'Renamed',
          [PSS_PROJECT_BIND]: `/msdyn_projects(${OTHER_PROJECT_ID})`,
          [CUSTOM_PROJECT_BIND]: `/pmo_projects(${OTHER_PROJECT_ID})`,
        },
      });
    });

    const [id, payload] = updateUatTestCase.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe(CASE_ID);
    expect(PSS_PROJECT_BIND in payload).toBe(false);
    expect(CUSTOM_PROJECT_BIND in payload).toBe(false);
    // The other direction: the rest of the payload must still land, or the guard is
    // just a broken update.
    expect(payload.pmo_title).toBe('Renamed');
  });

  it('leaves a payload with no project bind exactly as it was', async () => {
    updateUatTestCase.mockResolvedValue({ pmo_uattestcaseid: CASE_ID });
    const { wrapper } = harness();
    const { result } = renderHook(() => useUpdateUatTestCase(PROJECT_ID), { wrapper });

    const payload = { pmo_title: 'Renamed', pmo_objective: 'Still here', pmo_estimatedminutes: 45 };
    await act(async () => {
      await result.current.mutateAsync({ id: CASE_ID, payload });
    });

    expect(updateUatTestCase.mock.calls[0][1]).toEqual(payload);
  });

  it('strips the run’s denormalized copy too, so it cannot diverge from its case', async () => {
    // The parity half. A run pointing at a different project from its own case would be
    // counted in one portfolio rollup and missing from another, with nothing failing.
    updateUatTestRun.mockResolvedValue({ pmo_uattestrunid: RUN_ID });
    const { wrapper } = harness();
    const { result } = renderHook(() => useUpdateUatTestRun(CASE_ID), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: RUN_ID,
        payload: {
          pmo_minutes: 12,
          pmo_minutesoverridden: false,
          [PSS_PROJECT_BIND]: `/msdyn_projects(${OTHER_PROJECT_ID})`,
          [CUSTOM_PROJECT_BIND]: `/pmo_projects(${OTHER_PROJECT_ID})`,
        },
      });
    });

    const payload = updateUatTestRun.mock.calls[0][1] as Record<string, unknown>;
    expect(PSS_PROJECT_BIND in payload).toBe(false);
    expect(CUSTOM_PROJECT_BIND in payload).toBe(false);
    expect(payload).toEqual({ pmo_minutes: 12, pmo_minutesoverridden: false });
  });
});
