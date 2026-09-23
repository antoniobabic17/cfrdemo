/**
 * customColumns — Excel-style formula engine for admin-authored computed columns.
 *
 * A custom column stores a single formula string, e.g.:
 *   =IF([Budget]>100000,"Large",CONCATENATE([Status]," - ",LEFT([Name],5)))
 *
 * Field references use [Display Name] syntax (bracket-quoted, space-safe).
 * Formulas are evaluated per-row against the row's already-fetched data;
 * no cross-row or multi-table lookups are supported.
 *
 * Storage:
 *   - New shape:    { id, label, formula, teamId? }   (formula is the string)
 *   - Legacy shape: { id, label, parts[], separator, teamId? }
 *
 * Backward compatibility: migrateLegacyFormula() converts old parts[] rows to
 * equivalent formula strings. parseCustomColumns (tableViewRegistry.ts) calls
 * this on read so storage self-heals on the next save — no migration script
 * needed.
 *
 * Evaluation errors render as "#ERROR: <message>" in the cell so a broken
 * formula never crashes the entire grid.
 */

// ─── Model ────────────────────────────────────────────────────────────────────

/** The reserved prefix for custom-column runtime keys. */
export const CUSTOM_COL_PREFIX = '__custom__';

export function customColumnRuntimeKey(id: string): string {
  return `${CUSTOM_COL_PREFIX}${id}`;
}

export function isCustomColumnKey(key: string): boolean {
  return key.startsWith(CUSTOM_COL_PREFIX);
}

export function customColumnIdFromKey(key: string): string | null {
  return key.startsWith(CUSTOM_COL_PREFIX) ? key.slice(CUSTOM_COL_PREFIX.length) : null;
}

export interface CustomColumnFormula {
  /** Stable UUID. Runtime key = `__custom__${id}`. */
  id: string;
  /** Admin-supplied display label. */
  label: string;
  /** Excel-style formula string, e.g. `=CONCATENATE([Budget]," USD")`. */
  formula: string;
  /** Optional Dataverse team GUID — restricts visibility to that team + admins. */
  teamId?: string;
}

/** Legacy (pre-formula-bar) stored shape — kept ONLY for migration. */
interface LegacyCustomColumnPart {
  colKey: string;
  transform?: 'left' | 'right';
  chars?: number;
  dateFormat?: 'YYYY' | 'MM/YYYY' | 'MM/DD/YYYY';
}
interface LegacyCustomColumnFormula {
  id: string;
  label: string;
  parts: LegacyCustomColumnPart[];
  separator?: string;
  teamId?: string;
}

// ─── readCellValue (reused by the evaluator) ──────────────────────────────────

/**
 * Read a cell value from a row record, preferring the Dataverse
 * FormattedValue annotation over the raw scalar. Returns '' for null/undefined.
 *
 * Exported so DataTable and tests can reuse it without a circular dep.
 */
export function readCellValue(row: Record<string, unknown>, colKey: string): string {
  const fv = row[`${colKey}@OData.Community.Display.V1.FormattedValue`];
  if (fv != null && fv !== '') return String(fv);
  const raw = row[colKey];
  if (raw == null) return '';
  if (typeof raw === 'object') {
    try { return JSON.stringify(raw); } catch { return ''; }
  }
  return String(raw);
}

/**
 * Read a cell value as a best-effort typed primitive (number, string) so
 * arithmetic operators (`>`, `+`, etc.) work on genuine numeric fields.
 *
 * IMPORTANT: a CHOICE/option-set field is stored as a number (e.g.
 * 508640001) but its meaningful value is the FormattedValue label
 * ("In-Progress"). So we return the raw number ONLY when the field has NO
 * FormattedValue annotation (a genuine numeric like Budget). When a
 * FormattedValue exists, that human string wins — matching what the grid and
 * the string reader show.
 */
export function readCellValueTyped(
  row: Record<string, unknown>,
  colKey: string,
): string | number | boolean {
  const fv = row[`${colKey}@OData.Community.Display.V1.FormattedValue`];
  if (fv != null && fv !== '') return String(fv); // choice/lookup/date label
  const raw = row[colKey];
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'boolean') return raw;
  return readCellValue(row, colKey);
}

// ─── Tokenizer ────────────────────────────────────────────────────────────────

type TokenKind =
  | 'FIELD'      // [Field Name]
  | 'STRING'     // "hello"
  | 'NUMBER'     // 123.45
  | 'IDENT'      // function name or keyword
  | 'OP'         // + - * / ^ & = <> <= >= < >
  | 'COMMA'      // ,
  | 'LPAREN'     // (
  | 'RPAREN'     // )
  | 'BOOL';      // TRUE / FALSE

interface Token {
  kind: TokenKind;
  value: string | number | boolean;
  /** Raw source text (for error messages). */
  raw: string;
}

function tokenize(src: string): Token[] {
  // Strip leading = (Excel convention)
  const input = src.startsWith('=') ? src.slice(1).trim() : src.trim();
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) { i++; continue; }

    // [Field Name]
    if (input[i] === '[') {
      const end = input.indexOf(']', i + 1);
      if (end === -1) throw new Error(`Unclosed '[' at position ${i}`);
      tokens.push({ kind: 'FIELD', value: input.slice(i + 1, end), raw: input.slice(i, end + 1) });
      i = end + 1;
      continue;
    }

    // String literal "..."
    if (input[i] === '"') {
      let j = i + 1;
      let s = '';
      while (j < input.length) {
        if (input[j] === '"') {
          if (input[j + 1] === '"') { s += '"'; j += 2; } // "" escape
          else { j++; break; }
        } else {
          s += input[j++];
        }
      }
      tokens.push({ kind: 'STRING', value: s, raw: input.slice(i, j) });
      i = j;
      continue;
    }

    // Number
    if (/[0-9]/.test(input[i]) || (input[i] === '-' && /[0-9]/.test(input[i + 1] ?? ''))) {
      // Only treat leading - as negation if no previous token or last was an operator/lparen.
      const last = tokens[tokens.length - 1];
      if (input[i] === '-' && last && last.kind !== 'OP' && last.kind !== 'LPAREN' && last.kind !== 'COMMA') {
        // It's a binary minus, not a negative number literal. Fall through to OP.
      } else {
        let j = i;
        if (input[j] === '-') j++;
        while (j < input.length && (/[0-9]/.test(input[j]) || input[j] === '.')) j++;
        const raw = input.slice(i, j);
        tokens.push({ kind: 'NUMBER', value: parseFloat(raw), raw });
        i = j;
        continue;
      }
    }

    // Multi-char operators first
    if (input.slice(i, i + 2) === '<>') { tokens.push({ kind: 'OP', value: '<>', raw: '<>' }); i += 2; continue; }
    if (input.slice(i, i + 2) === '<=') { tokens.push({ kind: 'OP', value: '<=', raw: '<=' }); i += 2; continue; }
    if (input.slice(i, i + 2) === '>=') { tokens.push({ kind: 'OP', value: '>=', raw: '>=' }); i += 2; continue; }

    // Single-char operators / delimiters
    const ch = input[i];
    if ('+-*/^&=<>'.includes(ch)) { tokens.push({ kind: 'OP', value: ch, raw: ch }); i++; continue; }
    if (ch === ',') { tokens.push({ kind: 'COMMA', value: ',', raw: ',' }); i++; continue; }
    if (ch === '(') { tokens.push({ kind: 'LPAREN', value: '(', raw: '(' }); i++; continue; }
    if (ch === ')') { tokens.push({ kind: 'RPAREN', value: ')', raw: ')' }); i++; continue; }

    // Identifier (function name / TRUE / FALSE)
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) j++;
      const raw = input.slice(i, j);
      const upper = raw.toUpperCase();
      if (upper === 'TRUE')  { tokens.push({ kind: 'BOOL', value: true,  raw }); i = j; continue; }
      if (upper === 'FALSE') { tokens.push({ kind: 'BOOL', value: false, raw }); i = j; continue; }
      tokens.push({ kind: 'IDENT', value: upper, raw });
      i = j;
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at position ${i}`);
  }

  return tokens;
}

// ─── Parser (recursive-descent → AST) ────────────────────────────────────────

type ASTNode =
  | { type: 'Literal';     value: string | number | boolean }
  | { type: 'FieldRef';    name: string }
  | { type: 'FunctionCall'; name: string; args: ASTNode[] }
  | { type: 'BinaryOp';    op: string; left: ASTNode; right: ASTNode }
  | { type: 'UnaryMinus';  expr: ASTNode };

class Parser {
  private pos = 0;
  private tokens: Token[];
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | undefined { return this.tokens[this.pos]; }
  private consume(): Token {
    const t = this.tokens[this.pos++];
    if (!t) throw new Error('Unexpected end of formula');
    return t;
  }
  private expect(kind: TokenKind): Token {
    const t = this.consume();
    if (t.kind !== kind) throw new Error(`Expected ${kind} but got ${t.kind} ('${t.raw}')`);
    return t;
  }

  parse(): ASTNode {
    const node = this.parseComparison();
    if (this.pos < this.tokens.length) {
      const t = this.peek();
      throw new Error(`Unexpected token '${t?.raw}' at position ${this.pos}`);
    }
    return node;
  }

  /** Comparison: = <> < > <= >= (lowest precedence) */
  private parseComparison(): ASTNode {
    let left = this.parseConcat();
    while (this.peek()?.kind === 'OP' && /^(=|<>|<=|>=|<|>)$/.test(String(this.peek()!.value))) {
      const op = String(this.consume().value);
      const right = this.parseConcat();
      left = { type: 'BinaryOp', op, left, right };
    }
    return left;
  }

  /** String concatenation with & */
  private parseConcat(): ASTNode {
    let left = this.parseAddSub();
    while (this.peek()?.kind === 'OP' && this.peek()!.value === '&') {
      this.consume();
      const right = this.parseAddSub();
      left = { type: 'BinaryOp', op: '&', left, right };
    }
    return left;
  }

  /** Addition and subtraction */
  private parseAddSub(): ASTNode {
    let left = this.parseMulDiv();
    while (this.peek()?.kind === 'OP' && (this.peek()!.value === '+' || this.peek()!.value === '-')) {
      const op = String(this.consume().value);
      const right = this.parseMulDiv();
      left = { type: 'BinaryOp', op, left, right };
    }
    return left;
  }

  /** Multiplication and division */
  private parseMulDiv(): ASTNode {
    let left = this.parsePower();
    while (this.peek()?.kind === 'OP' && (this.peek()!.value === '*' || this.peek()!.value === '/')) {
      const op = String(this.consume().value);
      const right = this.parsePower();
      left = { type: 'BinaryOp', op, left, right };
    }
    return left;
  }

  /** Exponentiation (right-associative) */
  private parsePower(): ASTNode {
    let left = this.parseUnary();
    if (this.peek()?.kind === 'OP' && this.peek()!.value === '^') {
      this.consume();
      const right = this.parsePower(); // right-assoc
      left = { type: 'BinaryOp', op: '^', left, right };
    }
    return left;
  }

  /** Unary minus */
  private parseUnary(): ASTNode {
    if (this.peek()?.kind === 'OP' && this.peek()!.value === '-') {
      this.consume();
      const expr = this.parseUnary();
      return { type: 'UnaryMinus', expr };
    }
    return this.parsePrimary();
  }

  /** Literals, field refs, function calls, parenthesised expressions */
  private parsePrimary(): ASTNode {
    const t = this.peek();
    if (!t) throw new Error('Unexpected end of formula');

    if (t.kind === 'NUMBER' || t.kind === 'STRING' || t.kind === 'BOOL') {
      this.consume();
      return { type: 'Literal', value: t.value };
    }

    if (t.kind === 'FIELD') {
      this.consume();
      return { type: 'FieldRef', name: String(t.value) };
    }

    if (t.kind === 'IDENT') {
      const name = String(t.value);
      this.consume();
      // Function call?
      if (this.peek()?.kind === 'LPAREN') {
        this.consume(); // consume '('
        const args: ASTNode[] = [];
        if (this.peek()?.kind !== 'RPAREN') {
          args.push(this.parseComparison());
          while (this.peek()?.kind === 'COMMA') {
            this.consume();
            // Allow trailing comma before closing paren
            if (this.peek()?.kind === 'RPAREN') break;
            args.push(this.parseComparison());
          }
        }
        this.expect('RPAREN');
        return { type: 'FunctionCall', name, args };
      }
      // Bare identifier (not followed by '(') — treat as a string literal
      // so e.g. IF([x]=TRUE,...) works with bare TRUE/FALSE identifiers.
      // (TRUE/FALSE are tokenized as BOOL, not IDENT, so bare IDENTs here
      // are likely typos or unknown names — evaluate as empty string.)
      return { type: 'Literal', value: '' };
    }

    if (t.kind === 'LPAREN') {
      this.consume();
      const expr = this.parseComparison();
      this.expect('RPAREN');
      return expr;
    }

    throw new Error(`Unexpected token '${t.raw}'`);
  }
}

// ─── Evaluator ────────────────────────────────────────────────────────────────

import { FORMULA_FUNCTIONS } from './formulaFunctions';

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function applyBinaryOp(op: string, left: unknown, right: unknown): unknown {
  switch (op) {
    case '+': return toNumber(left) + toNumber(right);
    case '-': return toNumber(left) - toNumber(right);
    case '*': return toNumber(left) * toNumber(right);
    case '/': {
      const r = toNumber(right);
      return r === 0 ? '#DIV/0!' : toNumber(left) / r;
    }
    case '^': return Math.pow(toNumber(left), toNumber(right));
    case '&': return String(left ?? '') + String(right ?? '');
    case '=': {
      // Comparison: number if both coerce cleanly, else string
      const l = typeof left === 'number' ? left : String(left ?? '').toLowerCase();
      const r = typeof right === 'number' ? right : String(right ?? '').toLowerCase();
      return l == r; // eslint-disable-line eqeqeq
    }
    case '<>': {
      const l = typeof left === 'number' ? left : String(left ?? '').toLowerCase();
      const r = typeof right === 'number' ? right : String(right ?? '').toLowerCase();
      return l != r; // eslint-disable-line eqeqeq
    }
    case '<': return toNumber(left) < toNumber(right);
    case '>': return toNumber(left) > toNumber(right);
    case '<=': return toNumber(left) <= toNumber(right);
    case '>=': return toNumber(left) >= toNumber(right);
    default: throw new Error(`Unknown operator '${op}'`);
  }
}

function evalNode(
  node: ASTNode,
  row: Record<string, unknown>,
  colKeyByLabel: Record<string, string>,
): unknown {
  switch (node.type) {
    case 'Literal':
      return node.value;

    case 'FieldRef': {
      const colKey = colKeyByLabel[node.name.toLowerCase()];
      if (!colKey) return ''; // unknown field → empty (not an error)
      return readCellValueTyped(row, colKey);
    }

    case 'UnaryMinus':
      return -toNumber(evalNode(node.expr, row, colKeyByLabel));

    case 'BinaryOp': {
      const left = evalNode(node.left, row, colKeyByLabel);
      const right = evalNode(node.right, row, colKeyByLabel);
      return applyBinaryOp(node.op, left, right);
    }

    case 'FunctionCall': {
      const meta = FORMULA_FUNCTIONS[node.name];
      if (!meta) throw new Error(`Unknown function: ${node.name}`);
      const args = node.args.map((a) => evalNode(a, row, colKeyByLabel));
      return meta.fn(...args);
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Evaluate a custom column formula against a single data row.
 *
 * @param row          The raw data row (Record<string, unknown>).
 * @param formula      The stored CustomColumnFormula.
 * @param fieldIndex   Map from lowercased display-label → Dataverse colKey,
 *                     built once from the column catalog and passed in.
 *                     If omitted, field references resolve to empty string.
 */
export function evaluateCustomColumn(
  row: Record<string, unknown>,
  formula: CustomColumnFormula,
  fieldIndex?: Record<string, string>,
): string {
  const colKeyByLabel = fieldIndex ?? {};
  const src = formula.formula;
  if (!src || src.trim() === '=' || src.trim() === '') return '';
  try {
    const tokens = tokenize(src);
    const ast = new Parser(tokens).parse();
    const result = evalNode(ast, row, colKeyByLabel);
    if (result == null || result === '') return '';
    return String(result);
  } catch (err) {
    return `#ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Extract the [Field Display Name] references from a formula string.
 * Used by the re-pull impact checker to warn when a column used in a formula
 * is about to be removed from the catalog.
 * Returns an array of lowercased display-label strings.
 */
export function extractFormulaFieldRefs(formulaStr: string): string[] {
  if (!formulaStr) return [];
  const refs: string[] = [];
  try {
    const tokens = tokenize(formulaStr);
    for (const t of tokens) {
      if (t.kind === 'FIELD') refs.push(String(t.value).toLowerCase());
    }
  } catch {
    // Malformed formula — can't extract refs, return empty.
  }
  return refs;
}

// ─── Legacy migration ────────────────────────────────────────────────────────

/**
 * Convert an old parts[]-based formula to the equivalent formula string.
 * Called lazily by parseCustomColumns (tableViewRegistry.ts) so stored rows
 * self-heal on the next save.
 */
export function migrateLegacyFormula(
  old: LegacyCustomColumnFormula,
  labelByColKey?: Record<string, string>,
): CustomColumnFormula {
  const { id, label, teamId, parts, separator = ' ' } = old;

  const fieldLabel = (colKey: string): string => {
    // Try to get the admin-visible label from the catalog; fall back to colKey.
    return labelByColKey?.[colKey] ?? colKey;
  };

  function partToExpr(p: LegacyCustomColumnPart): string {
    if (!p.colKey) return '';
    const ref = `[${fieldLabel(p.colKey)}]`;
    if (p.transform === 'left' && p.chars) return `LEFT(${ref},${p.chars})`;
    if (p.transform === 'right' && p.chars) return `RIGHT(${ref},${p.chars})`;
    if (p.dateFormat === 'YYYY') return `TEXT(${ref},"YYYY")`;
    if (p.dateFormat === 'MM/YYYY') return `TEXT(${ref},"MM/YYYY")`;
    if (p.dateFormat === 'MM/DD/YYYY') return `TEXT(${ref},"MM/DD/YYYY")`;
    return ref;
  }

  const validParts = (parts ?? []).filter((p) => p.colKey);
  if (validParts.length === 0) {
    return { id, label, formula: '=""', teamId };
  }

  let formula: string;
  if (validParts.length === 1) {
    formula = `=${partToExpr(validParts[0])}`;
  } else {
    // CONCATENATE with separator inserted between non-empty parts.
    // When the separator is a space or simple literal, use CONCATENATE directly.
    // For multi-part concatenation we always use CONCATENATE for clarity.
    const sepLit = `"${separator.replace(/"/g, '""')}"`;
    const partExprs = validParts.map((p) => partToExpr(p));
    // Interleave parts with separator
    const allArgs = partExprs.reduce<string[]>((acc, e, i) => {
      if (i > 0) acc.push(sepLit);
      acc.push(e);
      return acc;
    }, []);
    formula = `=CONCATENATE(${allArgs.join(',')})`;
  }

  return { id, label, formula, teamId };
}

// ─── Type guard for legacy rows ───────────────────────────────────────────────

export function isLegacyFormula(
  f: CustomColumnFormula | LegacyCustomColumnFormula,
): f is LegacyCustomColumnFormula {
  return !('formula' in f) && 'parts' in f;
}
