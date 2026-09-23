import { describe, expect, it } from 'vitest';
import {
  parseTaskLabels, serializeTaskLabels, addTaskLabel, removeTaskLabel,
  renameTaskLabel, sanitizeLabelName, sanitizeColor,
} from './taskLabelText';

describe('parse/serialize', () => {
  it('parses name:#color pairs', () => {
    expect(parseTaskLabels('Urgent:#e11d48;Blocked:#f59e0b')).toEqual([
      { name: 'Urgent', color: '#e11d48' },
      { name: 'Blocked', color: '#f59e0b' },
    ]);
  });

  it('returns [] for null/empty/whitespace', () => {
    expect(parseTaskLabels(null)).toEqual([]);
    expect(parseTaskLabels('')).toEqual([]);
    expect(parseTaskLabels('  ; ;')).toEqual([]);
  });

  it('defaults color when missing or invalid', () => {
    expect(parseTaskLabels('NoColor')).toEqual([{ name: 'NoColor', color: '#64748b' }]);
    expect(parseTaskLabels('Bad:#zzz')).toEqual([{ name: 'Bad', color: '#64748b' }]);
  });

  it('dedupes by case-insensitive name, last color wins', () => {
    expect(parseTaskLabels('P0:#111111;p0:#222222')).toEqual([{ name: 'P0', color: '#222222' }]);
  });

  it('round-trips through serialize', () => {
    const t = 'Urgent:#e11d48;UX Review:#8b5cf6';
    expect(serializeTaskLabels(parseTaskLabels(t))).toBe(t);
  });
});

describe('sanitize', () => {
  it('strips delimiter chars and trims names', () => {
    expect(sanitizeLabelName('  a;b:c  ')).toBe('abc');
    expect(sanitizeLabelName(undefined)).toBe('');
  });
  it('normalizes colors', () => {
    expect(sanitizeColor('#ABCDEF')).toBe('#abcdef');
    expect(sanitizeColor('red')).toBe('#64748b');
    expect(sanitizeColor(null)).toBe('#64748b');
  });
});

describe('add', () => {
  it('adds a new label', () => {
    expect(addTaskLabel('', 'New', '#123456')).toBe('New:#123456');
  });
  it('is idempotent by name and updates color', () => {
    expect(addTaskLabel('New:#111111', 'new', '#222222')).toBe('New:#222222');
  });
  it('sanitizes the name (drops delimiters)', () => {
    expect(addTaskLabel('', 'a;b:c', '#123456')).toBe('abc:#123456');
  });
  it('no-ops on empty name', () => {
    expect(addTaskLabel('X:#111111', '   ')).toBe('X:#111111');
  });
});

describe('remove', () => {
  it('removes by case-insensitive name', () => {
    expect(removeTaskLabel('A:#111111;B:#222222', 'a')).toBe('B:#222222');
  });
  it('no-ops when not present', () => {
    expect(removeTaskLabel('A:#111111', 'Z')).toBe('A:#111111');
  });
});

describe('rename', () => {
  it('renames in place, preserving color + position', () => {
    expect(renameTaskLabel('A:#111111;B:#222222', 'A', 'Alpha')).toBe('Alpha:#111111;B:#222222');
  });
  it('merges when renamed onto an existing label (drops dup)', () => {
    expect(renameTaskLabel('A:#111111;B:#222222', 'A', 'B')).toBe('B:#111111');
  });
  it('no-ops when the old name is absent', () => {
    expect(renameTaskLabel('A:#111111', 'Z', 'Y')).toBe('A:#111111');
  });
});
