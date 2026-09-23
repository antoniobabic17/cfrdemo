/**
 * demoFilter — a small, pragmatic OData `$filter` / `$orderby` / `$top` evaluator
 * for Demo Mode's in-memory store.
 *
 * This is NOT a full OData grammar. It covers exactly the shapes this app emits
 * (catalogued from every dv.list() call site):
 *
 *   comparisons:   field eq 'x' | field ne 5 | field gt|ge|lt|le <value>
 *   logic:         a and b | a or b  (with parentheses)
 *   functions:     contains(field,'x') | startswith(field,'x') | endswith(field,'x')
 *   membership:    nav/any(alias: alias/field eq 'guid')
 *   literals:      'quoted string' | 123 | 3.14 | true | false | null
 *                  and GUIDs both quoted ('...') and bare (…eq 00000000-…)
 *
 * Evaluation is case-insensitive for field NAMES only when they match a record
 * key case-insensitively — Dataverse logical names are lowercase in practice so
 * this is a safety net, not a feature. String comparisons themselves follow
 * OData semantics: eq/ne on strings is case-INSENSITIVE (Dataverse default),
 * contains/startswith/endswith are case-insensitive too.
 *
 * Anything we can't parse throws DemoFilterParseError; the caller (demoStore)
 * logs a console.warn and falls back to returning the unfiltered set so a demo
 * never hard-crashes on an unexpected filter.
 */

export class DemoFilterParseError extends Error {
  readonly expr: string;
  constructor(message: string, expr: string) {
    super(`${message} — in filter: ${expr}`);
    this.name = 'DemoFilterParseError';
    this.expr = expr;
  }
}

type Rec = Record<string, unknown>;

// ─── Tokenizer ──────────────────────────────────────────────────────────────

type TokKind = 'lparen' | 'rparen' | 'and' | 'or' | 'ident' | 'string' | 'number' | 'bool' | 'null' | 'op' | 'comma' | 'colon' | 'slash';
interface Tok { kind: TokKind; value: string; }

const COMPARE_OPS = new Set(['eq', 'ne', 'gt', 'ge', 'lt', 'le']);
const FUNCS = new Set(['contains', 'startswith', 'endswith']);

function tokenize(input: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '(') { toks.push({ kind: 'lparen', value: '(' }); i++; continue; }
    if (c === ')') { toks.push({ kind: 'rparen', value: ')' }); i++; continue; }
    if (c === ',') { toks.push({ kind: 'comma', value: ',' }); i++; continue; }
    if (c === ':') { toks.push({ kind: 'colon', value: ':' }); i++; continue; }
    if (c === '/') { toks.push({ kind: 'slash', value: '/' }); i++; continue; }
    if (c === "'") {
      // string literal; OData escapes a quote by doubling it ('')
      let j = i + 1;
      let s = '';
      while (j < n) {
        if (input[j] === "'") {
          if (input[j + 1] === "'") { s += "'"; j += 2; continue; }
          break;
        }
        s += input[j];
        j++;
      }
      if (j >= n) throw new DemoFilterParseError('Unterminated string literal', input);
      toks.push({ kind: 'string', value: s });
      i = j + 1;
      continue;
    }
    // word: keyword, ident (may contain _ and digits), function, operator, bool, null, or bare guid/number
    if (/[A-Za-z0-9_.\-]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_.\-]/.test(input[j])) j++;
      const word = input.slice(i, j);
      const lower = word.toLowerCase();
      i = j;
      if (lower === 'and') toks.push({ kind: 'and', value: 'and' });
      else if (lower === 'or') toks.push({ kind: 'or', value: 'or' });
      else if (lower === 'true' || lower === 'false') toks.push({ kind: 'bool', value: lower });
      else if (lower === 'null') toks.push({ kind: 'null', value: 'null' });
      else if (COMPARE_OPS.has(lower)) toks.push({ kind: 'op', value: lower });
      else if (/^-?\d+(\.\d+)?$/.test(word)) toks.push({ kind: 'number', value: word });
      else toks.push({ kind: 'ident', value: word }); // ident OR bare guid (looks like ident with dashes)
      continue;
    }
    throw new DemoFilterParseError(`Unexpected character '${c}'`, input);
  }
  return toks;
}

// ─── AST ────────────────────────────────────────────────────────────────────

type Node =
  | { t: 'and'; l: Node; r: Node }
  | { t: 'or'; l: Node; r: Node }
  | { t: 'cmp'; field: string; op: string; value: Literal }
  | { t: 'func'; fn: string; field: string; value: Literal }
  | { t: 'any'; navField: string; inner: Node; alias: string };

type Literal = { kind: 'string' | 'number' | 'bool' | 'null' | 'bareguid'; value: string };

// ─── Parser (recursive descent; precedence: or < and < primary) ──────────────

class Parser {
  private pos = 0;
  private toks: Tok[];
  private src: string;
  constructor(toks: Tok[], src: string) {
    this.toks = toks;
    this.src = src;
  }

  private peek(): Tok | undefined { return this.toks[this.pos]; }
  private next(): Tok { return this.toks[this.pos++]; }
  private expect(kind: TokKind): Tok {
    const t = this.toks[this.pos];
    if (!t || t.kind !== kind) throw new DemoFilterParseError(`Expected ${kind}`, this.src);
    return this.next();
  }

  parse(): Node {
    const node = this.parseOr();
    if (this.pos !== this.toks.length) throw new DemoFilterParseError('Trailing tokens', this.src);
    return node;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.peek()?.kind === 'or') {
      this.next();
      const right = this.parseAnd();
      left = { t: 'or', l: left, r: right };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parsePrimary();
    while (this.peek()?.kind === 'and') {
      this.next();
      const right = this.parsePrimary();
      left = { t: 'and', l: left, r: right };
    }
    return left;
  }

  private parsePrimary(): Node {
    const t = this.peek();
    if (!t) throw new DemoFilterParseError('Unexpected end of filter', this.src);

    if (t.kind === 'lparen') {
      this.next();
      const inner = this.parseOr();
      this.expect('rparen');
      return inner;
    }

    // function call: contains(field,'x')
    if (t.kind === 'ident' && FUNCS.has(t.value.toLowerCase()) && this.toks[this.pos + 1]?.kind === 'lparen') {
      const fn = this.next().value.toLowerCase();
      this.expect('lparen');
      const field = this.parseFieldPath();
      this.expect('comma');
      const value = this.parseLiteral();
      this.expect('rparen');
      return { t: 'func', fn, field, value };
    }

    // membership: nav/any(alias: alias/field eq 'guid')
    // detect ident followed by /any(
    if (t.kind === 'ident' && this.toks[this.pos + 1]?.kind === 'slash') {
      // could be nav/any(...) OR a field path used in a comparison (rare). Peek for 'any'.
      const save = this.pos;
      const nav = this.next().value;
      this.expect('slash');
      const fn = this.peek();
      if (fn && fn.kind === 'ident' && fn.value.toLowerCase() === 'any' && this.toks[this.pos + 1]?.kind === 'lparen') {
        this.next(); // any
        this.expect('lparen');
        const alias = this.expect('ident').value;
        this.expect('colon');
        const inner = this.parseOr(); // inner clause references alias/field
        this.expect('rparen');
        return { t: 'any', navField: nav, inner, alias };
      }
      // not an any() — restore and treat as a (possibly aliased) field path comparison
      this.pos = save;
    }

    // comparison: field eq value  (field may be a path like alias/systemuserid)
    const field = this.parseFieldPath();
    const op = this.peek();
    if (!op || op.kind !== 'op') throw new DemoFilterParseError('Expected comparison operator', this.src);
    this.next();
    const value = this.parseLiteral();
    return { t: 'cmp', field, op: op.value, value };
  }

  /** Parse a field path: ident ( '/' ident )*  → returns the LAST segment (the field name).
   *  Alias-qualified paths (alias/field) resolve to `field` for evaluation. */
  private parseFieldPath(): string {
    let seg = this.expect('ident').value;
    while (this.peek()?.kind === 'slash') {
      this.next();
      seg = this.expect('ident').value;
    }
    return seg;
  }

  private parseLiteral(): Literal {
    const t = this.next();
    if (!t) throw new DemoFilterParseError('Expected literal', this.src);
    switch (t.kind) {
      case 'string': return { kind: 'string', value: t.value };
      case 'number': return { kind: 'number', value: t.value };
      case 'bool':   return { kind: 'bool', value: t.value };
      case 'null':   return { kind: 'null', value: t.value };
      case 'ident':  return { kind: 'bareguid', value: t.value }; // bare guid / unquoted token
      default: throw new DemoFilterParseError(`Unexpected literal token '${t.value}'`, this.src);
    }
  }
}

// ─── Evaluation ───────────────────────────────────────────────────────────────

function getFieldCI(rec: Rec, field: string): unknown {
  if (field in rec) return rec[field];
  const lower = field.toLowerCase();
  for (const k of Object.keys(rec)) {
    if (k.toLowerCase() === lower) return rec[k];
  }
  return undefined;
}

function litToValue(l: Literal): unknown {
  switch (l.kind) {
    case 'string': return l.value;
    case 'number': return Number(l.value);
    case 'bool': return l.value === 'true';
    case 'null': return null;
    case 'bareguid': return l.value; // compare as string
  }
}

function looseEq(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) return b === null;
  if (typeof a === 'string' && typeof b === 'string') {
    // GUIDs/strings: strip braces, compare case-insensitively
    return a.replace(/[{}]/g, '').toLowerCase() === b.replace(/[{}]/g, '').toLowerCase();
  }
  if (typeof a === 'number' && typeof b === 'string') return a === Number(b);
  if (typeof a === 'boolean') return a === b;
  return a === b;
}

function compare(a: unknown, op: string, b: unknown): boolean {
  switch (op) {
    case 'eq': return looseEq(a, b);
    case 'ne': return !looseEq(a, b);
    case 'gt': case 'ge': case 'lt': case 'le': {
      // numeric or date/string ordinal compare
      const an = typeof a === 'number' ? a : Date.parse(String(a));
      const bn = typeof b === 'number' ? b : Date.parse(String(b));
      let av: number | string = a as number | string;
      let bv: number | string = b as number | string;
      if (!Number.isNaN(an) && !Number.isNaN(bn)) { av = an; bv = bn; }
      else { av = String(a); bv = String(b); }
      if (op === 'gt') return av > bv;
      if (op === 'ge') return av >= bv;
      if (op === 'lt') return av < bv;
      return av <= bv;
    }
    default: return false;
  }
}

/** The membership `any()` node needs access to the store to resolve nav → related rows.
 *  For this app, every `any()` is team membership evaluated against the SAME record's
 *  nav collection, which the in-memory store models as an array field on the record
 *  (e.g. rec['teammembership_association'] = [{ teamid, systemuserid }, …]) OR, for the
 *  common systemuser⇄team case, a resolver injected by demoStore. We support the array
 *  form here and let demoStore pass a resolver for cross-entity cases. */
export interface AnyResolver {
  (record: Rec, navField: string): Rec[];
}

function evalNode(node: Node, rec: Rec, anyResolver?: AnyResolver): boolean {
  switch (node.t) {
    case 'and': return evalNode(node.l, rec, anyResolver) && evalNode(node.r, rec, anyResolver);
    case 'or': return evalNode(node.l, rec, anyResolver) || evalNode(node.r, rec, anyResolver);
    case 'cmp': {
      const actual = getFieldCI(rec, node.field);
      return compare(actual, node.op, litToValue(node.value));
    }
    case 'func': {
      const actual = getFieldCI(rec, node.field);
      if (actual === null || actual === undefined) return false;
      const hay = String(actual).toLowerCase();
      const needle = String(litToValue(node.value)).toLowerCase();
      if (node.fn === 'contains') return hay.includes(needle);
      if (node.fn === 'startswith') return hay.startsWith(needle);
      if (node.fn === 'endswith') return hay.endsWith(needle);
      return false;
    }
    case 'any': {
      // Resolve the related rows for this nav property, then return true if ANY
      // satisfies the inner clause (evaluated with the related row as context).
      const related = anyResolver
        ? anyResolver(rec, node.navField)
        : (Array.isArray(rec[node.navField]) ? (rec[node.navField] as Rec[]) : []);
      return related.some((r) => evalNode(node.inner, r, anyResolver));
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Compile a $filter string into a predicate. Throws DemoFilterParseError on bad input. */
export function compileFilter(filter: string, anyResolver?: AnyResolver): (rec: Rec) => boolean {
  const trimmed = filter.trim();
  if (!trimmed) return () => true;
  const ast = new Parser(tokenize(trimmed), trimmed).parse();
  return (rec: Rec) => evalNode(ast, rec, anyResolver);
}

/** Apply $orderby (comma-separated `field [asc|desc]`) to a copy of rows. */
export function applyOrderBy<T extends Rec>(rows: T[], orderby: string | undefined): T[] {
  if (!orderby || !orderby.trim()) return rows;
  const keys = orderby.split(',').map((seg) => {
    const [field, dir] = seg.trim().split(/\s+/);
    return { field, desc: (dir ?? 'asc').toLowerCase() === 'desc' };
  });
  const sorted = [...rows];
  sorted.sort((a, b) => {
    for (const { field, desc } of keys) {
      const av = getFieldCI(a, field);
      const bv = getFieldCI(b, field);
      let cmp: number;
      if (av === bv) cmp = 0;
      else if (av === null || av === undefined) cmp = -1;
      else if (bv === null || bv === undefined) cmp = 1;
      else {
        const an = typeof av === 'number' ? av : Date.parse(String(av));
        const bn = typeof bv === 'number' ? bv : Date.parse(String(bv));
        if (!Number.isNaN(an) && !Number.isNaN(bn)) cmp = an - bn;
        else cmp = String(av).localeCompare(String(bv));
      }
      if (cmp !== 0) return desc ? -cmp : cmp;
    }
    return 0;
  });
  return sorted;
}

/**
 * Full query application: filter → orderby → top. Never throws — on a filter it
 * can't parse it logs a warning and skips filtering (returns orderby/top of the
 * full set) so a demo keeps running.
 */
export function applyQuery<T extends Rec>(
  rows: T[],
  params: { $filter?: string; $orderby?: string; $top?: number } | undefined,
  anyResolver?: AnyResolver,
): T[] {
  let out = rows;
  if (params?.$filter) {
    try {
      const pred = compileFilter(params.$filter, anyResolver);
      out = out.filter(pred);
    } catch (err) {
      if (err instanceof DemoFilterParseError) {
        console.warn('[demoFilter] unparseable $filter, returning unfiltered set:', err.message);
      } else {
        throw err;
      }
    }
  }
  out = applyOrderBy(out, params?.$orderby);
  if (params?.$top !== undefined && out.length > params.$top) out = out.slice(0, params.$top);
  return out;
}
