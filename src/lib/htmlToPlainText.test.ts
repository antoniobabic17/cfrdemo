import { describe, expect, it } from 'vitest';
import { htmlToPlainText } from './htmlToPlainText';

describe('htmlToPlainText', () => {
  it('returns empty string for empty input', () => {
    expect(htmlToPlainText('')).toBe('');
  });

  it('strips tags but keeps the text content', () => {
    expect(htmlToPlainText('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('drops inline styles and class attributes (the Copilot/Outlook leak)', () => {
    const html =
      '<div style="font-family:Calibri;color:#1f1f1f;font-size:11pt">' +
      '<span class="x_ContentPasted0" style="margin:0">Quarterly numbers look good.</span></div>';
    const out = htmlToPlainText(html);
    expect(out).toBe('Quarterly numbers look good.');
    expect(out).not.toMatch(/style|class|font-family|margin|#1f1f1f/);
  });

  it('removes <style> and <script> blocks entirely (content not kept)', () => {
    const html =
      '<style>.x_ContentPasted0 { margin:0 }</style>' +
      '<p>Visible text</p>' +
      '<script>alert(1)</script>';
    const out = htmlToPlainText(html);
    expect(out).toBe('Visible text');
    expect(out).not.toMatch(/margin|alert|ContentPasted/);
  });

  it('converts <br> and block elements to newlines', () => {
    expect(htmlToPlainText('Line one<br>Line two')).toBe('Line one\nLine two');
    expect(htmlToPlainText('<p>Para one</p><p>Para two</p>')).toBe('Para one\nPara two');
  });

  it('turns list items into separate lines', () => {
    expect(htmlToPlainText('<ul><li>Alpha</li><li>Beta</li></ul>')).toBe('Alpha\nBeta');
  });

  it('collapses runaway whitespace and caps blank lines at one', () => {
    const html = '<p>Too    many     spaces</p>\n\n\n<p>and gaps</p>';
    // Intra-line runs collapse to a single space; paragraph breaks are kept
    // but never more than one blank line.
    expect(htmlToPlainText(html)).toBe('Too many spaces\n\nand gaps');
  });

  it('decodes HTML entities to real characters', () => {
    expect(htmlToPlainText('<p>R&amp;D &ndash; 100&nbsp;units</p>')).toBe('R&D \u2013 100\u00a0units');
  });

  it('produces no angle-bracket markup in the result', () => {
    const html = '<div><span style="color:red"><b>Bold</b> and <i>italic</i></span></div>';
    const out = htmlToPlainText(html);
    expect(out).toBe('Bold and italic');
    expect(out).not.toMatch(/[<>]/);
  });
});
