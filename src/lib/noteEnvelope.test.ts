import { describe, expect, it } from 'vitest';
import { splitNoteMeta, joinNoteMeta, toggleNoteReaction, stripSrcMarker, notePlainText } from './noteEnvelope';
import { extractMentions, toFriendlyMentions, toCanonicalMentions } from './mentionsParser';

const U1 = 'aaaaaaaa-1111-2222-3333-444444444444';
const U2 = 'bbbbbbbb-1111-2222-3333-444444444444';

describe('noteEnvelope', () => {
  describe('splitNoteMeta', () => {
    it('treats a plain note (no sentinel) as body-only with empty reactions', () => {
      const { body, meta } = splitNoteMeta('Just a normal note');
      expect(body).toBe('Just a normal note');
      expect(meta.reactions).toEqual({});
    });

    it('handles null / undefined / empty', () => {
      expect(splitNoteMeta(undefined)).toEqual({ body: '', meta: { reactions: {} } });
      expect(splitNoteMeta(null)).toEqual({ body: '', meta: { reactions: {} } });
      expect(splitNoteMeta('')).toEqual({ body: '', meta: { reactions: {} } });
    });

    it('decodes reactions from the trailing sentinel and strips it from the body', () => {
      const stored = `Hello team\n<!--cfrnote:v1 {"reactions":{"👍":["${U1}"]}}-->`;
      const { body, meta } = splitNoteMeta(stored);
      expect(body).toBe('Hello team');
      expect(meta.reactions).toEqual({ '👍': [U1] });
    });

    it('does not treat a mid-body "-->" as the sentinel', () => {
      const text = 'code snippet a --> b across lines\nsecond line';
      const { body, meta } = splitNoteMeta(text);
      expect(body).toBe(text);
      expect(meta.reactions).toEqual({});
    });

    it('falls back to whole-string body on a malformed sentinel', () => {
      const text = 'Body\n<!--cfrnote:v1 {not json}-->';
      const { body, meta } = splitNoteMeta(text);
      expect(body).toBe(text);
      expect(meta.reactions).toEqual({});
    });

    it('drops empty reaction arrays and non-string entries', () => {
      const stored = `x\n<!--cfrnote:v1 {"reactions":{"👍":[],"🎉":["${U1}",5]}}-->`;
      const { meta } = splitNoteMeta(stored);
      expect(meta.reactions).toEqual({ '🎉': [U1] });
    });
  });

  describe('joinNoteMeta', () => {
    it('emits just the body when there are no reactions (pristine for Timeline)', () => {
      expect(joinNoteMeta('Hello', { reactions: {} })).toBe('Hello');
    });

    it('round-trips body + reactions', () => {
      const notetext = joinNoteMeta('Hello @[Bob](x)', { reactions: { '🔥': [U1, U2] } });
      const { body, meta } = splitNoteMeta(notetext);
      expect(body).toBe('Hello @[Bob](x)');
      expect(meta.reactions).toEqual({ '🔥': [U1, U2] });
    });

    it('handles an empty body with reactions', () => {
      const notetext = joinNoteMeta('', { reactions: { '👍': [U1] } });
      const { body, meta } = splitNoteMeta(notetext);
      expect(body).toBe('');
      expect(meta.reactions).toEqual({ '👍': [U1] });
    });
  });

  describe('toggleNoteReaction', () => {
    it('adds a reaction when absent', () => {
      expect(toggleNoteReaction({}, '👍', U1)).toEqual({ '👍': [U1] });
    });
    it('removes the user and deletes the emoji key when last', () => {
      expect(toggleNoteReaction({ '👍': [U1] }, '👍', U1)).toEqual({});
    });
    it('removes only the toggling user', () => {
      expect(toggleNoteReaction({ '👍': [U1, U2] }, '👍', U1)).toEqual({ '👍': [U2] });
    });
    it('is pure (does not mutate the input)', () => {
      const input = { '👍': [U1] };
      toggleNoteReaction(input, '🎉', U2);
      expect(input).toEqual({ '👍': [U1] });
    });
  });

  describe('friendly <-> canonical mention round-trip', () => {
    it('hides the GUID for display and restores it on serialize', () => {
      const canonical = `Hey @[Frosch, Seth](${U1}) look`;
      const { text, mentions } = toFriendlyMentions(canonical);
      expect(text).toBe('Hey @Frosch, Seth look');
      expect(mentions).toEqual([{ name: 'Frosch, Seth', userId: U1 }]);
      expect(toCanonicalMentions(text, mentions)).toBe(canonical);
    });

    it('drops a mention whose friendly token the user deleted', () => {
      const mentions = [{ name: 'Frosch, Seth', userId: U1 }];
      // user removed the @mention text entirely
      expect(toCanonicalMentions('no mention here', mentions)).toBe('no mention here');
    });

    it('replaces longest names first so prefixes do not clobber', () => {
      const mentions = [
        { name: 'Sam', userId: U1 },
        { name: 'Sam Smith', userId: U2 },
      ];
      const out = toCanonicalMentions('@Sam Smith and @Sam', mentions);
      expect(out).toBe(`@[Sam Smith](${U2}) and @[Sam](${U1})`);
    });
  });

  describe('mention extraction on a note body', () => {
    it('extracts inline @[Name](id) chips and ignores the reaction tag', () => {
      const notetext = joinNoteMeta(
        `Hey @[Bob Smith](${U1}) and @[Amy Lee](${U2})`,
        { reactions: { '👍': [U1] } },
      );
      const { body } = splitNoteMeta(notetext);
      const mentions = extractMentions(body);
      expect(mentions.map((m) => m.userId)).toEqual([U1, U2]);
      expect(mentions.map((m) => m.name)).toEqual(['Bob Smith', 'Amy Lee']);
    });
  });
});

describe('stripSrcMarker', () => {
  const GUID = '9fb1958b-408c-9723-a9fb-4d37caf85f72';
  it('returns empty string for null/undefined/empty', () => {
    expect(stripSrcMarker(undefined)).toBe('');
    expect(stripSrcMarker(null)).toBe('');
    expect(stripSrcMarker('')).toBe('');
  });
  it('leaves a marker-free note unchanged (trimmed)', () => {
    expect(stripSrcMarker('Sent the fallout spreadsheet.')).toBe('Sent the fallout spreadsheet.');
  });
  it('removes a trailing [[src:<guid>]] marker and surrounding blank space', () => {
    const raw = `Uploaded claims to the HPI.

[[src:${GUID}]]`;
    expect(stripSrcMarker(raw)).toBe('Uploaded claims to the HPI.');
  });
  it('removes an inline marker and collapses to a single space', () => {
    const raw = `before [[src:${GUID}]] after`;
    expect(stripSrcMarker(raw)).toBe('before after');
  });
  it('is case-insensitive on the guid hex and handles multiple markers', () => {
    const g2 = '12CE9E73-826A-1363-A5AA-8AD903277C95';
    const raw = `body [[src:${GUID}]] mid [[src:${g2}]]`;
    expect(stripSrcMarker(raw)).toBe('body mid');
  });
  it('does not touch a non-marker bracket text', () => {
    expect(stripSrcMarker('see [[note]] here')).toBe('see [[note]] here');
  });
});

describe('notePlainText', () => {
  const GUID = '9fb1958b-408c-9723-a9fb-4d37caf85f72';
  it('returns empty string for null/undefined/empty', () => {
    expect(notePlainText(undefined)).toBe('');
    expect(notePlainText(null)).toBe('');
    expect(notePlainText('')).toBe('');
  });
  it('strips HTML tags and collapses whitespace to a single line', () => {
    const raw = '<div>Item one</div><ul><li>a</li><li>b</li></ul>';
    expect(notePlainText(raw)).toBe('Item one a b');
  });
  it('decodes &nbsp; and trims', () => {
    expect(notePlainText('hello&nbsp;&nbsp;world')).toBe('hello world');
  });
  it('turns legacy canonical mentions into @Name', () => {
    expect(notePlainText('ping @[Jane Doe](abc-123) please')).toBe('ping @Jane Doe please');
  });
  it('also removes the src marker (composes with stripSrcMarker)', () => {
    const raw = `<p>Uploaded claims.</p> [[src:${GUID}]]`;
    expect(notePlainText(raw)).toBe('Uploaded claims.');
  });
});
