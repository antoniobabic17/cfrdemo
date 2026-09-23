import { decodeHtmlEntities } from '../components/common/RichTextEditor';

/**
 * Convert an arbitrary HTML fragment (e.g. a Copilot chat or Outlook email
 * body on the clipboard) to plain text. Uses the DOM parser so scripts/styles
 * never execute, drops <style>/<script> content entirely, turns block-level
 * breaks (</p>, <br>, </div>, </li>) into newlines, and collapses the runaway
 * whitespace those sources are notorious for. Returns text only — no markup,
 * so none of the pasted CSS/spans can leak into a note.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  const tpl = document.createElement('template');
  // Strip <style>/<script> blocks up front so their text content isn't kept.
  tpl.innerHTML = html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, '');
  const walk = (node: Node): string => {
    let out = '';
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.textContent ?? '';
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        const tag = el.tagName;
        if (tag === 'BR') { out += '\n'; return; }
        out += walk(el);
        if (/^(P|DIV|LI|UL|OL|TR|H[1-6]|BLOCKQUOTE)$/.test(tag)) out += '\n';
      }
    });
    return out;
  };
  return decodeHtmlEntities(walk(tpl.content))
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
