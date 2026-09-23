/**
 * T022's acceptance, enforced by driving the REAL three-step chain.
 *
 * uatToggles.test.ts already covers resolveUatEnabledForProject as a pure function.
 * That is a different claim: the tab is only correct if the hook actually composes the
 * organisation toggle, the team override AND the project row — and composes them in the
 * one-way direction. A pure-function test would stay green if the hook forgot to
 * consult team overrides at all, which is precisely the bug ProjectDetailPage's other
 * nine tabs have (finding 40).
 *
 * So this drives useUatProjectTabEnabled with real toggle maps, a real team override
 * built with teamTogglesKey, and real settings shapes.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

let mockGlobal: Record<string, boolean> = {};
let mockTeams: Set<string> = new Set();
let mockSettings: { pmo_key: string | null; pmo_value: string | null }[] = [];
let mockProjectSetting: { data: unknown; isPending: boolean } = { data: [], isPending: false };

vi.mock('../../../providers/ConfigurationProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../providers/ConfigurationProvider')>();
  return { ...actual, useFeatureToggles: () => mockGlobal };
});
vi.mock('../../../hooks/useCurrentUserTeams', () => ({
  useCurrentUserTeams: () => mockTeams,
}));
vi.mock('../../../hooks/useAppSettings', () => ({
  useAppSettings: () => ({ data: mockSettings }),
}));
vi.mock('../../../hooks/useUatDefects', () => ({
  useUatProjectSetting: () => mockProjectSetting,
}));

import { teamTogglesKey } from '../../../lib/teamSettings';
import { UAT_DEFAULT_TOGGLES, UAT_TOGGLE_KEYS } from './uatToggles';
import { useUatProjectTabEnabled } from './useUatProjectTabEnabled';

const PROJECT_ID = '99999999-9999-9999-9999-999999999999';
const TEAM_ID = 'cccccccc-1111-2222-3333-444444444444';

function teamOptOut(value: boolean) {
  return [{
    pmo_key: teamTogglesKey(TEAM_ID),
    pmo_value: JSON.stringify({ [UAT_TOGGLE_KEYS.projectTab]: value }),
  }];
}

beforeEach(() => {
  mockGlobal = { ...UAT_DEFAULT_TOGGLES };
  mockTeams = new Set();
  mockSettings = [];
  mockProjectSetting = { data: [], isPending: false };
});

describe('useUatProjectTabEnabled — the three-step chain', () => {
  it('shows the tab when nothing has turned it off, with NO settings row', () => {
    // The overwhelmingly common case: ~2,026 projects have no row and none was
    // backfilled. Absence must mean inherit.
    const { result } = renderHook(() => useUatProjectTabEnabled(PROJECT_ID));
    expect(result.current.enabled).toBe(true);
    expect(result.current.reason).toBe('enabled-inherited');
  });

  it('hides the tab when the ORGANISATION toggle is off', () => {
    mockGlobal = { ...UAT_DEFAULT_TOGGLES, [UAT_TOGGLE_KEYS.projectTab]: false };
    const { result } = renderHook(() => useUatProjectTabEnabled(PROJECT_ID));
    expect(result.current.enabled).toBe(false);
    expect(result.current.reason).toBe('disabled-organisation-or-team');
  });

  it('hides the tab when the TEAM has opted out', () => {
    // This is the assertion the other nine tabs would fail: they read the raw global.
    mockTeams = new Set([TEAM_ID]);
    mockSettings = teamOptOut(false);
    const { result } = renderHook(() => useUatProjectTabEnabled(PROJECT_ID));
    expect(
      result.current.enabled,
      'The hook must use useEffectiveFeatureToggles, or team opt-outs are ignored.',
    ).toBe(false);
  });

  it('does NOT let a team re-enable what the organisation turned off', () => {
    mockGlobal = { ...UAT_DEFAULT_TOGGLES, [UAT_TOGGLE_KEYS.projectTab]: false };
    mockTeams = new Set([TEAM_ID]);
    mockSettings = teamOptOut(true);
    const { result } = renderHook(() => useUatProjectTabEnabled(PROJECT_ID));
    expect(result.current.enabled).toBe(false);
  });

  it('hides the tab when the PROJECT flag is explicitly false', () => {
    mockProjectSetting = { data: [{ pmo_uatenabled: false }], isPending: false };
    const { result } = renderHook(() => useUatProjectTabEnabled(PROJECT_ID));
    expect(result.current.enabled).toBe(false);
    expect(result.current.reason).toBe('disabled-project');
  });

  it('treats a project row with a NULL flag as inherit, not as off', () => {
    mockProjectSetting = { data: [{ pmo_uatenabled: null }], isPending: false };
    const { result } = renderHook(() => useUatProjectTabEnabled(PROJECT_ID));
    expect(result.current.enabled).toBe(true);
    expect(result.current.reason).toBe('enabled-inherited');
  });

  it('does NOT let a project flag re-enable what the organisation turned off', () => {
    mockGlobal = { ...UAT_DEFAULT_TOGGLES, [UAT_TOGGLE_KEYS.projectTab]: false };
    mockProjectSetting = { data: [{ pmo_uatenabled: true }], isPending: false };
    const { result } = renderHook(() => useUatProjectTabEnabled(PROJECT_ID));
    expect(
      result.current.enabled,
      'A stale project flag must not resurrect a withdrawn capability.',
    ).toBe(false);
  });

  it('shows the tab while the settings row is still loading', () => {
    // Hiding first and revealing later would flicker the tab in for nearly every
    // project, because inherit-enabled is the common case.
    mockProjectSetting = { data: undefined, isPending: true };
    const { result } = renderHook(() => useUatProjectTabEnabled(PROJECT_ID));
    expect(result.current.enabled).toBe(true);
    expect(result.current.isResolving).toBe(true);
  });

  it('does not wait on the settings row when the organisation switch is already off', () => {
    // Nothing to resolve: the project flag cannot change the answer.
    mockGlobal = { ...UAT_DEFAULT_TOGGLES, [UAT_TOGGLE_KEYS.projectTab]: false };
    mockProjectSetting = { data: undefined, isPending: true };
    const { result } = renderHook(() => useUatProjectTabEnabled(PROJECT_ID));
    expect(result.current.enabled).toBe(false);
    expect(result.current.isResolving).toBe(false);
  });
});

/**
 * The page wiring. A correct hook that the page never calls is worth nothing — the
 * same reachability point as findings 32 and 35.
 */
describe('ProjectDetailPage wiring', () => {
  const pageSource = Object.values(
    import.meta.glob('../../../pages/Projects/ProjectDetailPage.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  )[0];

  it('loaded the page source', () => {
    expect(pageSource).toBeTruthy();
  });

  it('resolves the UAT tab through the hook, not through the raw global', () => {
    expect(pageSource).toContain('useUatProjectTabEnabled(');
    // Reading projectTab.uat off ftAll would skip the team override and the project row.
    expect(pageSource).not.toContain("ftAll['projectTab.uat']");
  });

  it('gates BOTH the trigger and the content on the same value', () => {
    // If only one were gated the tab would be visible but empty, or present but
    // unreachable.
    expect(pageSource).toContain('{tabEnabled.uat && (');
    expect(pageSource).toContain('<TabsTrigger value="uat">');
    expect(pageSource).toContain('<TabsContent value="uat"');
    expect(pageSource).toContain('<ProjectUatTab projectId={id} />');
  });

  it("registers 'uat' as a valid tab so a deep link resolves", () => {
    const urlStateSource = Object.values(
      import.meta.glob('../../../hooks/useUrlState.ts', {
        query: '?raw',
        import: 'default',
        eager: true,
      }) as Record<string, string>,
    )[0];
    expect(urlStateSource).toContain("'uat'");
  });
});
