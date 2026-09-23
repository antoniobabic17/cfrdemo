/**
 * T019's acceptance, enforced rather than stated.
 *
 * Every UAT write must route through useAppMutation, which owns the 60s timeout, the
 * shared transient-retry policy, the red toast and the pmo_telemetryevent row. A bare
 * `useMutation` holds the rejection privately: on a 403 / 500 / timeout nothing
 * toasted and nothing landed in Error Log. useAppMutation's own header cites the PROD
 * incident that produced it.
 *
 * A comment saying "always use useAppMutation" is worth very little — the next hook
 * gets written by someone who has not read it. This scans the source instead.
 *
 * Uses import.meta.glob rather than node:fs because tsconfig.app.json is browser-only
 * (`types: ["vite/client"]`) and a node:fs import fails `tsc -b` even though vitest
 * runs it happily.
 */
import { describe, expect, it } from 'vitest';

/** Every UAT hook file. */
const uatHookSources = import.meta.glob('./useUat*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Every file under the UAT feature tree, which will grow from Phase 5 onward. */
const uatFeatureSources = import.meta.glob('../features/uat/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Test files are exempt: a test may legitimately construct a raw mutation. */
function productionOnly(sources: Record<string, string>): [string, string][] {
  return Object.entries(sources).filter(([path]) => !/\.test\.tsx?$/.test(path));
}

const allSources = [...productionOnly(uatHookSources), ...productionOnly(uatFeatureSources)];

describe('T019: every UAT write routes through useAppMutation', () => {
  it('found the UAT hook files to scan', () => {
    // Without this the suite passes vacuously if the glob pattern ever drifts.
    expect(Object.keys(uatHookSources).length).toBeGreaterThan(0);
  });

  it('has no bare useMutation in any UAT hook or feature file', () => {
    const offenders: string[] = [];
    for (const [path, text] of allSources) {
      text.split(/\r?\n/).forEach((line, index) => {
        // `useAppMutation` contains `useMutation` as a substring, so match on a word
        // boundary that a preceding "App" would break.
        if (/(?<![A-Za-z])useMutation\s*[<(]/.test(line)) {
          offenders.push(`${path}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      'Route the write through useAppMutation instead. A bare useMutation holds the '
      + 'rejection privately: no toast, no Error Log row, and the user sees nothing.',
    ).toEqual([]);
  });

  it('imports useAppMutation in every UAT hook file that writes', () => {
    const missing: string[] = [];
    for (const [path, text] of productionOnly(uatHookSources)) {
      const writes = /export function use(Create|Update|Delete|Start|Reorder|Reparent|Rank)/.test(text);
      if (writes && !text.includes("from './useAppMutation'")) {
        missing.push(path);
      }
    }
    expect(missing, 'These hook files expose a write but do not import useAppMutation.').toEqual([]);
  });

  /**
   * useAppMutation's contract: "Do NOT toast from here; useAppMutation owns that."
   * Some pre-existing hooks in this repo toast from their own onError anyway and
   * double-toast on failure (progress.md finding 34). The UAT hooks must not join
   * them — onError here is for optimistic rollback only.
   */
  it('does not toast from a caller onError, which would double-toast', () => {
    const offenders: string[] = [];
    for (const [path, text] of productionOnly(uatHookSources)) {
      // Find each onError body and check it for a toast call.
      const pattern = /onError:\s*\([^)]*\)\s*=>\s*\{([\s\S]*?)\n {4}\}/g;
      let match: RegExpExecArray | null = pattern.exec(text);
      while (match !== null) {
        if (/\btoast\./.test(match[1])) {
          offenders.push(`${path}: onError calls toast.* — useAppMutation already toasts`);
        }
        match = pattern.exec(text);
      }
      // Also catch the single-expression form: onError: () => toast.error(...)
      if (/onError:\s*\([^)]*\)\s*=>\s*toast\./.test(text)) {
        offenders.push(`${path}: onError returns a toast call — useAppMutation already toasts`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Every mutation needs an `action`, because it is both the fallback toast message
   * and AppErrorContext.action — the field that makes an Admin > Error Log row
   * readable. A mutation without one produces a log entry nobody can act on.
   */
  it('gives every useAppMutation call an action label', () => {
    const offenders: string[] = [];
    for (const [path, text] of productionOnly(uatHookSources)) {
      const calls = text.split(/useAppMutation\s*\(\s*\{/).slice(1);
      calls.forEach((body, index) => {
        const head = body.slice(0, 400);
        if (!/\baction:\s*'/.test(head)) {
          offenders.push(`${path}: useAppMutation call ${index + 1} has no action label`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
