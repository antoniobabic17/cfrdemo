import { describe, it, expect } from 'vitest';
import {
  buildMentionChip,
  extractMentionUserIds,
  canonicalMentionsToChips,
} from './richMentions';

const U1 = 'aaaaaaaa-1111-2222-3333-444444444444';
const U2 = 'bbbbbbbb-1111-2222-3333-444444444444';

describe('richMentions', () => {
  describe('buildMentionChip', () => {
    it('builds a non-editable anchor with data-userid + escaped name', () => {
      const html = buildMentionChip('Frosch, Seth', U1);
      expect(html).toContain(`data-userid="${U1}"`);
      expect(html).toContain('data-mention="1"');
      expect(html).toContain('contenteditable="false"');
      expect(html).toContain('@Frosch, Seth');
    });
    it('escapes HTML in the name', () => {
      const html = buildMentionChip('<b>x</b> & "y"', U1);
      expect(html).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;');
      expect(html).not.toContain('<b>x</b>');
    });
    it('lower-cases the id', () => {
      expect(buildMentionChip('A', U1.toUpperCase())).toContain(`data-userid="${U1}"`);
    });
  });

  describe('extractMentionUserIds', () => {
    it('returns [] for empty / null', () => {
      expect(extractMentionUserIds('')).toEqual([]);
      expect(extractMentionUserIds(null)).toEqual([]);
      expect(extractMentionUserIds('no mentions here')).toEqual([]);
    });
    it('pulls ids from HTML chips', () => {
      const html = `<p>hi ${buildMentionChip('A', U1)} and ${buildMentionChip('B', U2)}</p>`;
      expect(extractMentionUserIds(html).sort()).toEqual([U1, U2].sort());
    });
    it('pulls ids from legacy canonical @[Name](id) text', () => {
      const txt = `hey @[Anna](${U1}) and @[Bob](${U2})`;
      expect(extractMentionUserIds(txt).sort()).toEqual([U1, U2].sort());
    });
    it('de-dupes across mixed forms + case', () => {
      const mixed = `${buildMentionChip('A', U1)} @[A again](${U1.toUpperCase()})`;
      expect(extractMentionUserIds(mixed)).toEqual([U1]);
    });
  });

  describe('canonicalMentionsToChips', () => {
    it('upgrades legacy canonical tokens to chips', () => {
      const out = canonicalMentionsToChips(`hi @[Anna](${U1})!`);
      expect(out).toContain(`data-userid="${U1}"`);
      expect(out).toContain('@Anna');
      expect(out).not.toContain(`@[Anna](${U1})`);
    });
    it('leaves plain text / existing chips unchanged', () => {
      expect(canonicalMentionsToChips('plain text')).toBe('plain text');
      const chip = buildMentionChip('A', U1);
      expect(canonicalMentionsToChips(chip)).toBe(chip);
    });
    it('round-trips: chips -> extract ids matches the source ids', () => {
      const html = canonicalMentionsToChips(`@[Anna](${U1}) and @[Bob](${U2})`);
      expect(extractMentionUserIds(html).sort()).toEqual([U1, U2].sort());
    });
  });
});
