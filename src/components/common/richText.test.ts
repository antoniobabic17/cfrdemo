import { describe, it, expect } from 'vitest';
import { decodeHtmlEntities, renderRichText } from './RichTextEditor';

describe('decodeHtmlEntities', () => {
  it('decodes &nbsp; to a non-breaking space', () => {
    expect(decodeHtmlEntities('a&nbsp;b')).toBe('a\u00a0b');
  });

  it('decodes decimal and hex numeric entities', () => {
    expect(decodeHtmlEntities('x&#160;y')).toBe('x\u00a0y');
    expect(decodeHtmlEntities('x&#xA0;y')).toBe('x\u00a0y');
  });

  it('decodes common typographic entities', () => {
    expect(decodeHtmlEntities('&ldquo;hi&rdquo;')).toBe('\u201chi\u201d');
    expect(decodeHtmlEntities('a&mdash;b')).toBe('a\u2014b');
  });

  it('leaves a genuinely-typed ampersand intact (not a valid entity)', () => {
    // "&D" and "R & D" are not entities; nothing should change.
    expect(decodeHtmlEntities('R&D')).toBe('R&D');
    expect(decodeHtmlEntities('cats & dogs')).toBe('cats & dogs');
  });

  it('is a no-op on empty / plain strings', () => {
    expect(decodeHtmlEntities('')).toBe('');
    expect(decodeHtmlEntities('plain text')).toBe('plain text');
  });
});

describe('renderRichText — literal &nbsp; regression', () => {
  it('does NOT render the visible text "&nbsp;" for a plain-text note that holds it', () => {
    // The reported bug: a stored plain-text note containing the characters
    // "&nbsp;" used to render as the literal text "&nbsp;".
    const stored = 'Settlement payment has been posted.&nbsp; Closing this project out.';
    const { __html } = renderRichText(stored);
    // The bug was double-escaping: "&" -> "&amp;" turned the literal "&nbsp;"
    // into "&amp;nbsp;", which the browser shows as the visible text "&nbsp;".
    // After the fix the entity is decoded to a real non-breaking space; the DOM
    // may re-serialize that char as the entity "&nbsp;" (which renders as a
    // space) — the key guarantee is it is NEVER the double-escaped form.
    expect(__html).not.toContain('&amp;nbsp;');
    // Verify what the USER sees: parse the HTML and read textContent. The nbsp
    // must be a real U+00A0 space, not the literal 6-character token "&nbsp;".
    const tpl = document.createElement('template');
    tpl.innerHTML = __html;
    const text = tpl.content.textContent ?? '';
    expect(text).toContain('posted.\u00a0');       // real non-breaking space
    expect(text).not.toContain('&nbsp;');           // NOT the literal token
  });

  it('preserves a real ampersand in plain text', () => {
    const { __html } = renderRichText('R&D budget');
    // Escaped for HTML safety, but semantically still an ampersand — NOT turned
    // into some entity token.
    expect(__html).toContain('R&amp;D budget');
  });

  it('leaves HTML-valued notes to the HTML branch (no entity decode applied)', () => {
    const { __html } = renderRichText('<p>hello&nbsp;world</p>');
    // HTML branch renders as-is (sanitized); the &nbsp; stays a real entity the
    // browser renders as a space — we just assert the paragraph survived.
    expect(__html).toContain('hello');
    expect(__html).toContain('world');
  });
});
