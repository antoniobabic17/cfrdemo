import { describe, expect, it } from 'vitest';
import { targetDefFor, aspectOptionsFor, aspectNeedsFetch } from './lookupResolver';

describe('lookupResolver', () => {
  describe('targetDefFor', () => {
    it('resolves systemuser', () => {
      expect(targetDefFor(['systemuser'])?.entitySet).toBe('systemusers');
    });
    it('resolves aaduser to the systemusers set (shared ids)', () => {
      expect(targetDefFor(['aaduser'])?.entitySet).toBe('systemusers');
    });
    it('is case-insensitive and picks the first known target', () => {
      expect(targetDefFor(['Unknownthing', 'SystemUser'])?.idField).toBe('systemuserid');
    });
    it('returns undefined for empty / unknown targets', () => {
      expect(targetDefFor(undefined)).toBeUndefined();
      expect(targetDefFor([])).toBeUndefined();
      expect(targetDefFor(['cr87a_widget'])).toBeUndefined();
    });
  });

  describe('aspectOptionsFor', () => {
    it('offers Name + GUID at minimum for an unknown target', () => {
      const ids = aspectOptionsFor(['cr87a_widget']).map((a) => a.id);
      expect(ids).toEqual(['name', 'guid']);
    });
    it('adds Email + Job Title for user targets', () => {
      const ids = aspectOptionsFor(['systemuser']).map((a) => a.id);
      expect(ids).toContain('name');
      expect(ids).toContain('guid');
      expect(ids).toContain('email');
      expect(ids).toContain('title');
    });
  });

  describe('aspectNeedsFetch', () => {
    it('name and guid are free (no secondary fetch)', () => {
      expect(aspectNeedsFetch(['systemuser'], 'name')).toBe(false);
      expect(aspectNeedsFetch(['systemuser'], 'guid')).toBe(false);
    });
    it('email and title need a fetch', () => {
      expect(aspectNeedsFetch(['systemuser'], 'email')).toBe(true);
      expect(aspectNeedsFetch(['systemuser'], 'title')).toBe(true);
    });
    it('unknown target: nothing needs fetch (only free name/guid offered)', () => {
      expect(aspectNeedsFetch(['cr87a_widget'], 'email')).toBe(false);
    });
  });
});
