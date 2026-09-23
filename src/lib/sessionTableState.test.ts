import { describe, expect, it, beforeEach } from 'vitest';
import {
  getSessionFilterSort,
  setSessionFilterSort,
  getSessionActiveView,
  setSessionActiveView,
  __resetSessionTableState,
} from './sessionTableState';

describe('sessionTableState', () => {
  beforeEach(() => __resetSessionTableState());

  describe('filter/sort store', () => {
    it('returns null before anything is stored (fresh load = Default)', () => {
      expect(getSessionFilterSort('cfr_project_list_view')).toBeNull();
    });

    it('round-trips filters/sort across reads (persists within a session)', () => {
      const state = { filters: { health: ['at', 'off'] }, sortKey: 'name', sortDir: 'desc' as const };
      setSessionFilterSort('cfr_project_list_view', state);
      expect(getSessionFilterSort('cfr_project_list_view')).toEqual(state);
    });

    it('keys are independent per table', () => {
      setSessionFilterSort('a', { filters: { x: '1' }, sortKey: null, sortDir: 'asc' });
      expect(getSessionFilterSort('b')).toBeNull();
    });

    it('is a no-op when key is undefined', () => {
      setSessionFilterSort(undefined, { filters: {}, sortKey: null, sortDir: 'asc' });
      expect(getSessionFilterSort(undefined)).toBeNull();
    });

    it('reset clears everything (simulates hard refresh)', () => {
      setSessionFilterSort('a', { filters: { x: '1' }, sortKey: null, sortDir: 'asc' });
      __resetSessionTableState();
      expect(getSessionFilterSort('a')).toBeNull();
    });
  });

  describe('active view store', () => {
    it('returns undefined before set (fresh load = Default)', () => {
      expect(getSessionActiveView('projects')).toBeUndefined();
    });

    it('round-trips the active view id (persists within a session)', () => {
      setSessionActiveView('projects', 'view-123');
      expect(getSessionActiveView('projects')).toBe('view-123');
    });

    it('reset clears the active view (hard refresh -> Default)', () => {
      setSessionActiveView('projects', 'view-123');
      __resetSessionTableState();
      expect(getSessionActiveView('projects')).toBeUndefined();
    });

    it('is a no-op when tableKey is undefined', () => {
      setSessionActiveView(undefined, 'view-123');
      expect(getSessionActiveView(undefined)).toBeUndefined();
    });
  });
});
