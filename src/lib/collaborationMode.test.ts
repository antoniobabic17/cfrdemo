import { describe, it, expect } from 'vitest';
import { coerceCollaborationMode, isCollaborationMode, getCollaborationMode } from './collaborationMode';

describe('coerceCollaborationMode', () => {
  it('returns team for undefined', () => {
    expect(coerceCollaborationMode(undefined)).toBe('team');
  });
  it('returns team for null', () => {
    expect(coerceCollaborationMode(null)).toBe('team');
  });
  it('returns team for empty string', () => {
    expect(coerceCollaborationMode('')).toBe('team');
  });
  it('returns team for unknown value', () => {
    expect(coerceCollaborationMode('nonsense')).toBe('team');
  });
  it('returns individual for individual', () => {
    expect(coerceCollaborationMode('individual')).toBe('individual');
  });
  it('returns team for team', () => {
    expect(coerceCollaborationMode('team')).toBe('team');
  });
});

describe('isCollaborationMode', () => {
  it('accepts team', () => expect(isCollaborationMode('team')).toBe(true));
  it('accepts individual', () => expect(isCollaborationMode('individual')).toBe(true));
  it('rejects other strings', () => expect(isCollaborationMode('other')).toBe(false));
  it('rejects undefined', () => expect(isCollaborationMode(undefined)).toBe(false));
});

describe('getCollaborationMode', () => {
  it('returns team when no setting', () => {
    expect(getCollaborationMode([])).toBe('team');
  });
  it('returns individual when set', () => {
    expect(getCollaborationMode([
      { pmo_key: 'pmo.collaboration_mode', pmo_value: 'individual' },
    ])).toBe('individual');
  });
  it('returns team for unknown value', () => {
    expect(getCollaborationMode([
      { pmo_key: 'pmo.collaboration_mode', pmo_value: 'legacy' },
    ])).toBe('team');
  });
  it('ignores unrelated settings', () => {
    expect(getCollaborationMode([
      { pmo_key: 'pmo.data_source', pmo_value: 'individual' },
    ])).toBe('team');
  });
  it('returns team for null value', () => {
    expect(getCollaborationMode([
      { pmo_key: 'pmo.collaboration_mode', pmo_value: null },
    ])).toBe('team');
  });
});
