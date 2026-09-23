import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// useDataSource() subscribes to the app-settings query; stub it so the module
// cache can be driven without a QueryClient or Dataverse. Read lazily inside the
// stub so each test can swap the value before rendering.
let mockSettings: ReadonlyArray<{ pmo_key: string | null; pmo_value: string | null }> | undefined;
vi.mock('../hooks/useAppSettings', () => ({
  useAppSettings: () => ({ data: mockSettings }),
}));

import {
  getDataSource,
  isDataSource,
  coerceDataSource,
  DATA_SOURCE_DEFAULT,
  DATA_SOURCE_SETTING_KEY,
  DATA_SOURCE_LEGACY_KEY,
  useDataSource,
  getCachedDataSource,
  // legacy aliases still exported for existing call sites
  getTaskSource,
  isTaskSource,
  useTaskSource,
  usesCustomTables,
} from './taskSource';

describe('dataSource', () => {
  describe('isDataSource', () => {
    it('accepts pss, custom, and sharepoint', () => {
      expect(isDataSource('pss')).toBe(true);
      expect(isDataSource('custom')).toBe(true);
      expect(isDataSource('sharepoint')).toBe(true);
    });
    it('rejects hybrid (dropped), unknowns, case, empty, undefined', () => {
      expect(isDataSource('hybrid')).toBe(false);
      expect(isDataSource('PSS')).toBe(false);
      expect(isDataSource('legacy')).toBe(false);
      expect(isDataSource('')).toBe(false);
      expect(isDataSource(undefined)).toBe(false);
    });
  });

  describe('coerceDataSource', () => {
    it('maps legacy hybrid -> custom', () => {
      expect(coerceDataSource('hybrid')).toBe('custom');
    });
    it('passes through custom', () => {
      expect(coerceDataSource('custom')).toBe('custom');
    });
    it('passes through sharepoint', () => {
      expect(coerceDataSource('sharepoint')).toBe('sharepoint');
    });
    it('defaults everything else to pss', () => {
      expect(coerceDataSource('pss')).toBe('pss');
      expect(coerceDataSource('garbage')).toBe('pss');
      expect(coerceDataSource(null)).toBe('pss');
      expect(coerceDataSource(undefined)).toBe('pss');
    });
  });

  describe('getDataSource', () => {
    it('returns default when settings is undefined/empty/absent', () => {
      expect(getDataSource(undefined)).toBe(DATA_SOURCE_DEFAULT);
      expect(getDataSource([])).toBe(DATA_SOURCE_DEFAULT);
      expect(getDataSource([{ pmo_key: 'pmo.other', pmo_value: 'x' }])).toBe(DATA_SOURCE_DEFAULT);
    });
    it('reads the new pmo.data_source key', () => {
      expect(getDataSource([{ pmo_key: DATA_SOURCE_SETTING_KEY, pmo_value: 'custom' }])).toBe('custom');
      expect(getDataSource([{ pmo_key: DATA_SOURCE_SETTING_KEY, pmo_value: 'pss' }])).toBe('pss');
      expect(getDataSource([{ pmo_key: DATA_SOURCE_SETTING_KEY, pmo_value: 'sharepoint' }])).toBe('sharepoint');
    });
    it('falls back to the legacy pmo.task_source key when the new key is absent', () => {
      expect(getDataSource([{ pmo_key: DATA_SOURCE_LEGACY_KEY, pmo_value: 'custom' }])).toBe('custom');
    });
    it('coerces a legacy hybrid value to custom', () => {
      expect(getDataSource([{ pmo_key: DATA_SOURCE_LEGACY_KEY, pmo_value: 'hybrid' }])).toBe('custom');
    });
    it('prefers the new key over the legacy key', () => {
      const settings = [
        { pmo_key: DATA_SOURCE_LEGACY_KEY, pmo_value: 'pss' },
        { pmo_key: DATA_SOURCE_SETTING_KEY, pmo_value: 'custom' },
      ];
      expect(getDataSource(settings)).toBe('custom');
    });
    it('handles null pmo_value gracefully', () => {
      expect(getDataSource([{ pmo_key: DATA_SOURCE_SETTING_KEY, pmo_value: null }])).toBe(DATA_SOURCE_DEFAULT);
    });
  });

  // usesCustomTables() is the guard that makes data_source='sharepoint' take the
  // same pmo_* schema code paths as 'custom'. 71 call sites depend on it, so a
  // regression here silently routes SharePoint mode down the PSS/msdyn path.
  describe('usesCustomTables', () => {
    it('is true for the custom Dataverse path', () => {
      expect(usesCustomTables('custom')).toBe(true);
    });
    it('is true for the SharePoint path (same pmo_* schema)', () => {
      expect(usesCustomTables('sharepoint')).toBe(true);
    });
    it('is false for pss', () => {
      expect(usesCustomTables('pss')).toBe(false);
    });
  });

  describe('legacy aliases', () => {
    it('getTaskSource/isTaskSource still resolve to the unified value', () => {
      expect(getTaskSource([{ pmo_key: DATA_SOURCE_SETTING_KEY, pmo_value: 'custom' }])).toBe('custom');
      expect(isTaskSource('custom')).toBe(true);
      expect(isTaskSource('hybrid')).toBe(false);
    });
  });
});

/**
 * The module cache is published from an effect, not during render, so that
 * useDataSource() does not reassign a module-level variable while rendering
 * (react-hooks/globals). These tests exist because that publication was the one
 * behaviour the fix could have silently broken: nothing else asserts that
 * getCachedDataSource() ever stops returning the default.
 */
describe('module cache publication', () => {
  it('still reads the default before any render has committed', () => {
    // Order-dependent within this file by design: no test above renders the
    // hook, so the cache is untouched at this point.
    expect(getCachedDataSource()).toBe(DATA_SOURCE_DEFAULT);
  });

  it('publishes the resolved value once the render commits', () => {
    mockSettings = [{ pmo_key: DATA_SOURCE_SETTING_KEY, pmo_value: 'custom' }];
    const { result } = renderHook(() => useDataSource());
    expect(result.current).toBe('custom');
    expect(getCachedDataSource()).toBe('custom');
  });

  it('republishes when the resolved value changes', () => {
    mockSettings = [{ pmo_key: DATA_SOURCE_SETTING_KEY, pmo_value: 'custom' }];
    const { rerender } = renderHook(() => useDataSource());
    expect(getCachedDataSource()).toBe('custom');
    mockSettings = [{ pmo_key: DATA_SOURCE_SETTING_KEY, pmo_value: 'pss' }];
    rerender();
    expect(getCachedDataSource()).toBe('pss');
  });

  it('publishes through the legacy useTaskSource alias, coercing hybrid', () => {
    mockSettings = [{ pmo_key: DATA_SOURCE_LEGACY_KEY, pmo_value: 'hybrid' }];
    renderHook(() => useTaskSource());
    expect(getCachedDataSource()).toBe('custom');
  });
});
