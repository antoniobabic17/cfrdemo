import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// usePeopleSource() subscribes to the app-settings query; stub it so the module
// cache can be driven without a QueryClient or Dataverse. Read lazily inside the
// stub so each test can swap the value before rendering.
let mockSettings: ReadonlyArray<{ pmo_key: string | null; pmo_value: string | null }> | undefined;
vi.mock('../hooks/useAppSettings', () => ({
  useAppSettings: () => ({ data: mockSettings }),
}));

import {
  coercePeopleSource, isPeopleSource, getPeopleSource,
  PEOPLE_SOURCE_SETTING_KEY, PEOPLE_SOURCE_DEFAULT,
  usePeopleSource, getCachedPeopleSource,
} from './peopleSource';

describe('peopleSource', () => {
  it('coerces raw values to the enum', () => {
    expect(coercePeopleSource('o365')).toBe('o365');
    expect(coercePeopleSource('systemuser')).toBe('systemuser');
    expect(coercePeopleSource('nonsense')).toBe('systemuser');
    expect(coercePeopleSource(undefined)).toBe('systemuser');
    expect(coercePeopleSource(null)).toBe('systemuser');
  });

  it('isPeopleSource type guard', () => {
    expect(isPeopleSource('o365')).toBe(true);
    expect(isPeopleSource('systemuser')).toBe(true);
    expect(isPeopleSource('x')).toBe(false);
    expect(isPeopleSource(undefined)).toBe(false);
  });

  it('default is systemuser (safe with no connector)', () => {
    expect(PEOPLE_SOURCE_DEFAULT).toBe('systemuser');
  });

  it('getPeopleSource reads the setting from a settings array', () => {
    expect(getPeopleSource(undefined)).toBe('systemuser');
    expect(getPeopleSource([])).toBe('systemuser');
    expect(getPeopleSource([{ pmo_key: PEOPLE_SOURCE_SETTING_KEY, pmo_value: 'o365' }])).toBe('o365');
    expect(getPeopleSource([{ pmo_key: PEOPLE_SOURCE_SETTING_KEY, pmo_value: 'bogus' }])).toBe('systemuser');
    expect(getPeopleSource([{ pmo_key: 'other.key', pmo_value: 'o365' }])).toBe('systemuser');
  });
});

/**
 * The module cache is published from an effect, not during render, so that
 * usePeopleSource() does not reassign a module-level variable while rendering
 * (react-hooks/globals). Nothing else asserts that getCachedPeopleSource() ever
 * stops returning the default, so these cover the one behaviour the fix could
 * have silently broken.
 */
describe('peopleSource module cache publication', () => {
  it('still reads the default before any render has committed', () => {
    // Order-dependent within this file by design: no test above renders the
    // hook, so the cache is untouched at this point.
    expect(getCachedPeopleSource()).toBe(PEOPLE_SOURCE_DEFAULT);
  });

  it('publishes the resolved value once the render commits', () => {
    mockSettings = [{ pmo_key: PEOPLE_SOURCE_SETTING_KEY, pmo_value: 'o365' }];
    const { result } = renderHook(() => usePeopleSource());
    expect(result.current).toBe('o365');
    expect(getCachedPeopleSource()).toBe('o365');
  });

  it('republishes when the resolved value changes', () => {
    mockSettings = [{ pmo_key: PEOPLE_SOURCE_SETTING_KEY, pmo_value: 'o365' }];
    const { rerender } = renderHook(() => usePeopleSource());
    expect(getCachedPeopleSource()).toBe('o365');
    mockSettings = [{ pmo_key: PEOPLE_SOURCE_SETTING_KEY, pmo_value: 'systemuser' }];
    rerender();
    expect(getCachedPeopleSource()).toBe('systemuser');
  });
});
