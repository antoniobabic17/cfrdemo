/**
 * T020's acceptance, enforced.
 *
 * Three claims, and the second is the one worth testing:
 *
 *   1. all seven keys exist in DEFAULT_FEATURE_TOGGLES and are surfaced in the admin UI;
 *   2. a team CANNOT turn a UAT key on while the organisation has it off;
 *   3. absence of a project settings row means INHERIT, never "disabled".
 *
 * On (2): useEffectiveFeatureToggles already implements the one-way rule generically,
 * and it has its own tests. That is not the same claim. The UAT keys inherit the
 * guarantee only if they actually flow through that hook, so this drives the hook with
 * a real UAT key rather than asserting the hook works in the abstract — the same
 * distinction as findings 32 and 35.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Drive the resolver with controllable global toggles, team membership and settings.
let mockGlobal: Record<string, boolean> = {};
let mockTeams: Set<string> = new Set();
let mockSettings: { pmo_key: string | null; pmo_value: string | null }[] = [];

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

import { DEFAULT_FEATURE_TOGGLES } from '../../../providers/ConfigurationProvider';
import { useEffectiveFeatureToggles } from '../../../hooks/useEffectiveFeatureToggles';
import {
  UAT_TOGGLE_KEYS,
  ALL_UAT_TOGGLE_KEYS,
  UAT_DEFAULT_TOGGLES,
  isUatCapabilityEnabled,
  resolveUatEnabledForProject,
  explainUatEnablement,
} from './uatToggles';
import { teamTogglesKey } from '../../../lib/teamSettings';
import type { UatProjectSetting } from '../../../models/uatDefect.model';

const TEAM_ID = 'aaaaaaaa-1111-2222-3333-444444444444';

// Built with teamTogglesKey rather than a literal. The prefix is
// 'pmo.team_toggles.' -- a hand-written guess at the format silently produced a
// setting the resolver ignored, and the test then "proved" a team could not opt out.
// A wrong key here fails open, which is the worst direction for a permission test.

/** The admin surface, read as source so the test does not need to render it. */
const featureToggleSectionSource = Object.values(
  import.meta.glob('../../../components/admin/FeatureToggleSection.tsx', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>,
)[0];

beforeEach(() => {
  mockGlobal = { ...UAT_DEFAULT_TOGGLES };
  mockTeams = new Set();
  mockSettings = [];
});

describe('the seven UAT toggle keys', () => {
  it('has exactly seven', () => {
    expect(ALL_UAT_TOGGLE_KEYS).toHaveLength(7);
    expect([...ALL_UAT_TOGGLE_KEYS].sort()).toEqual([
      'nav.uat',
      'projectTab.uat',
      'uat.coverage',
      'uat.defects',
      'uat.import',
      'uat.requirements',
      'uat.templates',
    ]);
  });

  it('registers every key in DEFAULT_FEATURE_TOGGLES', () => {
    const missing = ALL_UAT_TOGGLE_KEYS.filter((k) => !(k in DEFAULT_FEATURE_TOGGLES));
    expect(missing, 'Spread UAT_DEFAULT_TOGGLES into DEFAULT_FEATURE_TOGGLES.').toEqual([]);
  });

  it('defaults every key to true, because G-ENABLE is opt-out not opt-in', () => {
    for (const key of ALL_UAT_TOGGLE_KEYS) {
      expect(DEFAULT_FEATURE_TOGGLES[key], `${key} should default on`).toBe(true);
    }
  });

  it('surfaces every key in the admin toggle UI', () => {
    expect(featureToggleSectionSource, 'FeatureToggleSection.tsx was not loaded').toBeTruthy();
    // Referenced via UAT_TOGGLE_KEYS.<name>, so assert the property name appears in a
    // key: position rather than looking for the raw string.
    const missing = Object.entries(UAT_TOGGLE_KEYS)
      .filter(([name]) => !new RegExp(`key:\\s*UAT_TOGGLE_KEYS\\.${name}\\b`).test(featureToggleSectionSource))
      .map(([, key]) => key);
    expect(missing, 'Add these to the UAT Manager group in FeatureToggleSection.tsx.').toEqual([]);
  });

  it('gives every UAT toggle a disableWarning, so turning one off explains itself', () => {
    // Every other group in this file warns on disable. A UAT switch that silently
    // hides evidence capture would be the worst one to omit.
    const uatGroup = featureToggleSectionSource.slice(
      featureToggleSectionSource.indexOf("id: 'uat-manager'"),
    );
    const keyCount = (uatGroup.match(/key:\s*UAT_TOGGLE_KEYS\./g) ?? []).length;
    const warningCount = (uatGroup.match(/disableWarning:/g) ?? []).length;
    expect(keyCount).toBe(7);
    expect(warningCount).toBe(7);
  });
});

describe('precedence is one-way (G-ENABLE: opt-out by team)', () => {
  it('lets a team turn a UAT key OFF for itself', () => {
    mockTeams = new Set([TEAM_ID]);
    mockSettings = [{
      pmo_key: teamTogglesKey(TEAM_ID),
      pmo_value: JSON.stringify({ [UAT_TOGGLE_KEYS.defects]: false }),
    }];
    const { result } = renderHook(() => useEffectiveFeatureToggles());
    expect(result.current[UAT_TOGGLE_KEYS.defects]).toBe(false);
    // And only that key.
    expect(result.current[UAT_TOGGLE_KEYS.templates]).toBe(true);
  });

  it('does NOT let a team turn a UAT key ON when the organisation has it off', () => {
    mockGlobal = { ...UAT_DEFAULT_TOGGLES, [UAT_TOGGLE_KEYS.import]: false };
    mockTeams = new Set([TEAM_ID]);
    mockSettings = [{
      pmo_key: teamTogglesKey(TEAM_ID),
      pmo_value: JSON.stringify({ [UAT_TOGGLE_KEYS.import]: true }),
    }];
    const { result } = renderHook(() => useEffectiveFeatureToggles());
    expect(
      result.current[UAT_TOGGLE_KEYS.import],
      'A team override must never grant a capability the organisation has withdrawn.',
    ).toBe(false);
  });

  it('ignores an override from a team the user does not belong to', () => {
    mockTeams = new Set(['bbbbbbbb-0000-0000-0000-000000000000']);
    mockSettings = [{
      pmo_key: teamTogglesKey(TEAM_ID),
      pmo_value: JSON.stringify({ [UAT_TOGGLE_KEYS.defects]: false }),
    }];
    const { result } = renderHook(() => useEffectiveFeatureToggles());
    expect(result.current[UAT_TOGGLE_KEYS.defects]).toBe(true);
  });
});

describe('isUatCapabilityEnabled', () => {
  it('treats a missing key as ON, matching opt-out semantics', () => {
    expect(isUatCapabilityEnabled({}, UAT_TOGGLE_KEYS.coverage)).toBe(true);
  });

  it('respects an explicit false', () => {
    expect(
      isUatCapabilityEnabled({ [UAT_TOGGLE_KEYS.coverage]: false }, UAT_TOGGLE_KEYS.coverage),
    ).toBe(false);
  });
});

describe('project-level resolution: absence means INHERIT', () => {
  const row = (enabled: boolean | null): UatProjectSetting =>
    ({ pmo_uatenabled: enabled } as UatProjectSetting);

  it('treats no settings row as enabled — the ~2,026-project no-backfill case', () => {
    expect(resolveUatEnabledForProject(true, [])).toBe(true);
    expect(resolveUatEnabledForProject(true, undefined)).toBe(true);
    expect(explainUatEnablement(true, [])).toBe('enabled-inherited');
  });

  it('treats a row with a null flag as inherit, not as false', () => {
    expect(resolveUatEnabledForProject(true, [row(null)])).toBe(true);
    expect(explainUatEnablement(true, [row(null)])).toBe('enabled-inherited');
  });

  it('lets a project turn UAT off for itself', () => {
    expect(resolveUatEnabledForProject(true, [row(false)])).toBe(false);
    expect(explainUatEnablement(true, [row(false)])).toBe('disabled-project');
  });

  it('does NOT let a project turn UAT on when the organisation or team has it off', () => {
    expect(
      resolveUatEnabledForProject(false, [row(true)]),
      'A stale project flag must not resurrect a withdrawn capability.',
    ).toBe(false);
    expect(explainUatEnablement(false, [row(true)])).toBe('disabled-organisation-or-team');
  });

  it('reports an explicit project-level enable distinctly from an inherited one', () => {
    expect(explainUatEnablement(true, [row(true)])).toBe('enabled-project-explicit');
  });
});
