/**
 * Tests for the generated UAT option-set maps.
 *
 * These do NOT re-assert every integer against a second hand-typed copy of the
 * same numbers. A test that duplicates its subject only proves someone typed the
 * same thing twice, and it makes the generator's output harder to regenerate,
 * which is the opposite of what this file is for.
 *
 * What they do assert is the set of properties that must hold for ANY generated
 * version of the file, so they keep working after a legitimate regeneration and
 * fail on the mistakes that are actually plausible here:
 *
 *   - a value copied from one set into another (every set starts at the same
 *     base, so a wrong number is still a valid number -- see progress.md 24/29);
 *   - a set whose members drifted from what data-model.md specifies;
 *   - the two vocabulary decisions being quietly undone;
 *   - a label map that fell out of step with its value map;
 *   - one of the three unsettled columns appearing with invented members.
 */
import { describe, expect, it } from 'vitest';
import {
  UAT_OPTION_SET_REGISTRY,
  UAT_OUTCOME,
  UAT_EXECUTION_STATUS,
  UAT_COVERAGE_TYPE,
  UAT_IMPORT_BATCH_STATUS,
  UAT_IMPORT_ROW_STATUS,
  UAT_OUTCOME_LABELS,
  UAT_EXECUTION_STATUS_LABELS,
} from './uatOptionSets';

describe('generated UAT option sets', () => {
  it('covers all 16 sets that exist in Dataverse', () => {
    // 14 global (T013) + 2 local (T012). If a set is added, regenerate and bump.
    expect(Object.keys(UAT_OPTION_SET_REGISTRY)).toHaveLength(16);
  });

  it('gives every set a Dataverse source and a scope', () => {
    for (const [name, entry] of Object.entries(UAT_OPTION_SET_REGISTRY)) {
      expect(entry.source, `${name} has no source`).toMatch(/^pmo_uat/);
      expect(['global', 'local'], `${name} scope`).toContain(entry.scope);
    }
  });

  it('has no empty set', () => {
    for (const [name, entry] of Object.entries(UAT_OPTION_SET_REGISTRY)) {
      expect(Object.keys(entry.values).length, `${name} is empty`).toBeGreaterThan(0);
    }
  });

  it('keeps every value map and its label map in step', () => {
    for (const [name, entry] of Object.entries(UAT_OPTION_SET_REGISTRY)) {
      const values = Object.values(entry.values).sort((a, b) => a - b);
      const labelled = Object.keys(entry.labels).map(Number).sort((a, b) => a - b);
      expect(labelled, `${name}: label map keys do not match its values`).toEqual(values);
    }
  });

  it('has no duplicate integer inside any one set', () => {
    for (const [name, entry] of Object.entries(UAT_OPTION_SET_REGISTRY)) {
      const values = Object.values(entry.values);
      expect(new Set(values).size, `${name} has a duplicated integer`).toBe(values.length);
    }
  });

  it('uses only plausible Dataverse option integers', () => {
    // The pmo_ publisher's option prefix is 89346, so every value is 89346xxxx.
    // A value outside that range means a number was invented rather than read.
    for (const [name, entry] of Object.entries(UAT_OPTION_SET_REGISTRY)) {
      for (const [member, value] of Object.entries(entry.values)) {
        expect(value, `${name}.${member} = ${value} is outside the pmo_ option prefix`)
          .toBeGreaterThanOrEqual(893460000);
        expect(value, `${name}.${member} = ${value} is outside the pmo_ option prefix`)
          .toBeLessThan(893470000);
      }
    }
  });

  /**
   * The two decisions data-model.md 7 records as having been wrong in an earlier
   * draft. Both are absences, so only a test can hold them.
   */
  describe('the two vocabulary decisions', () => {
    it('pmo_uatoutcome ends in In Process, not Skipped', () => {
      expect(Object.keys(UAT_OUTCOME)).toEqual([
        'Pass', 'Fail', 'Blocked', 'NotApplicable', 'InProcess',
      ]);
      expect(UAT_OUTCOME).not.toHaveProperty('Skipped');
    });

    it('pmo_uatoutcome is the set behind a run result, so there is no Not Run', () => {
      expect(UAT_OUTCOME).not.toHaveProperty('NotRun');
      expect(Object.values(UAT_OUTCOME_LABELS)).not.toContain('Not Run');
    });

    it('pmo_uatexecutionstatus has exactly its five members', () => {
      // Four until 2026-08-31, when the owner ruled that a blocked case must show as blocked
      // rather than as In Process or Returned for Defect. FR-021 was amended with it.
      expect(Object.keys(UAT_EXECUTION_STATUS)).toEqual([
        'NotStarted', 'InProcess', 'Completed', 'ReturnedForDefect', 'Blocked',
      ]);
      // What FR-022 actually rests on, and what the member count never guaranteed.
      expect(Object.values(UAT_EXECUTION_STATUS_LABELS)).not.toContain('Fail');
    });
  });

  /**
   * The reason this file is namespaced per set. These four members share one
   * integer, so any code that treats an option value as globally meaningful is
   * wrong, and a flat map would have made that unavoidable.
   */
  it('demonstrates that one integer means four different things', () => {
    expect(UAT_OUTCOME.Pass).toBe(UAT_IMPORT_BATCH_STATUS.Staged);
    expect(UAT_OUTCOME.Pass).toBe(UAT_IMPORT_ROW_STATUS.Staged);
    expect(UAT_OUTCOME.Pass).toBe(UAT_COVERAGE_TYPE.Verifies);
    expect(UAT_OUTCOME_LABELS[UAT_OUTCOME.Pass]).toBe('Pass');
    expect(UAT_IMPORT_BATCH_STATUS).not.toBe(UAT_OUTCOME);
  });

  it('keeps the two import status vocabularies distinct despite sharing integers', () => {
    // Same base, different meaning at every position after the first.
    expect(Object.keys(UAT_IMPORT_BATCH_STATUS)).toEqual([
      'Staged', 'Committing', 'Completed', 'CompletedWithErrors', 'Cancelled',
    ]);
    expect(Object.keys(UAT_IMPORT_ROW_STATUS)).toEqual([
      'Staged', 'Created', 'Skipped', 'Failed',
    ]);
    expect(UAT_IMPORT_BATCH_STATUS.Committing).toBe(UAT_IMPORT_ROW_STATUS.Created);
  });

  /**
   * progress.md finding 27. These three columns have no settled members, so no
   * map for them may exist -- an empty or invented one would read as complete.
   */
  it('does not invent members for the three unsettled columns', () => {
    const names = Object.keys(UAT_OPTION_SET_REGISTRY);
    expect(names).not.toContain('UAT_DEFECT_CATEGORY');
    expect(names).not.toContain('UAT_ASSIGNED_TEAM');
    expect(names).not.toContain('UAT_TEMPLATE_CATEGORY');
  });
});

/**
 * G-OPTINT, enforced rather than merely stated.
 *
 * The gate says no feature file may read an option integer that did not come from
 * uatOptionSets.ts. A rule with no check is a rule that gets broken quietly, so
 * this walks the UAT feature tree for literal pmo_ option integers.
 *
 * It is scoped to src/features/uat because the rest of the app legitimately
 * carries its own 89346xxxx literals (constants.ts ARTIFACT_TYPE_LABELS, for one),
 * and a repo-wide ban would be noise that someone would soon disable.
 *
 * The directory does not exist until Phase 5. The test passes trivially until then
 * and starts enforcing the moment the first UAT feature file lands -- which is the
 * point: a guard added later is a guard added after the violation.
 *
 * Uses import.meta.glob rather than node:fs deliberately. tsconfig.app.json is
 * browser-only (types: ["vite/client"]), so a node:fs import fails `tsc -b` even
 * though vitest runs it happily -- and widening the app's type surface to add a
 * test guard is a worse trade than using the bundler feature that is already typed.
 */
const uatFeatureSources = import.meta.glob('../features/uat/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('G-OPTINT: no hard-coded option integers under features/uat', () => {
  it('finds no literal 89346xxxx integer in any UAT feature file', () => {
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(uatFeatureSources)) {
      text.split(/\r?\n/).forEach((line, index) => {
        if (/\b89346\d{4}\b/.test(line)) {
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      'Import the value from lib/uatOptionSets.ts instead. Every UAT set starts at '
      + 'the same base, so a literal is a valid integer for the wrong column.',
    ).toEqual([]);
  });
});
