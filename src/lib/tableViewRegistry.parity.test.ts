/**
 * tableViewRegistry.parity.test.ts — guards against the registry silently
 * drifting out of sync with the page column definitions it describes.
 *
 * Background: the Admin "Table Default Views" editor and the org-wide
 * column-rename feature (useColumnLabels) only work on keys that exist in
 * TABLE_VIEW_REGISTRY. A page column missing from the registry can never be
 * renamed by an admin; a stale registry key points at nothing. Both defects
 * happened silently in production (proj_actualfinishdate missing from
 * `projects`; _ownerid_value stale in `userFeedback`) before this test
 * existed. This test reads each page's SOURCE FILE (not a rendered
 * component — these are React components with hooks/data deps that make
 * import+render impractical for a pure structural check) and extracts every
 * `key: '...'` column definition, then diffs it against the registry.
 *
 * When this test fails, it means a column exists in the app but is
 * unreachable from admin settings (or vice versa) — fix the registry, don't
 * skip the test.
 */
/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TABLE_VIEW_REGISTRY } from './tableViewRegistry';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(__dirname, '..'); // app/src

/** Structural/pinned action columns: header:'' or a Repush/action button, no
 *  display label to rename. DataTable already excludes these from the view
 *  editor's column picker (`c.header.trim() !== ''`). Never expected in the
 *  registry. */
const STRUCTURAL_KEYS = new Set(['actions', 'repush']);

/**
 * Keys that are intentionally registry-only (no matching page baseColumn),
 * with a one-line reason. Keep this list tiny and documented — every entry
 * is a deliberate exception, not a shortcut.
 */
const REGISTRY_ONLY_ALLOWED: Record<string, string[]> = {
  // msdyn_finish is a normalizer alias (→ pmo_finish on the custom source);
  // it is NOT one of ProjectListPage's hand-written baseColumns, it exists
  // purely so admins can label/reference the task-rollup finish date.
  projects: ['msdyn_finish'],
};

/** Extract every `key: '...'` from a column-array literal in a page source file. */
function extractKeys(sourcePath: string): string[] {
  const src = readFileSync(sourcePath, 'utf8');
  const keys: string[] = [];
  const re = /key:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (!STRUCTURAL_KEYS.has(m[1])) keys.push(m[1]);
  }
  return keys;
}

interface ParityCase {
  tableKey: string;
  /** Path relative to app/src. */
  pageFile: string;
}

const CASES: ParityCase[] = [
  { tableKey: 'projects', pageFile: 'pages/Projects/ProjectListPage.tsx' },
  { tableKey: 'programs', pageFile: 'pages/Programs/ProgramListPage.tsx' },
  { tableKey: 'intake', pageFile: 'pages/Intake/IntakeListPage.tsx' },
  { tableKey: 'userFeedback', pageFile: 'pages/Admin/UserFeedbackPage.tsx' },
  { tableKey: 'errorLog', pageFile: 'pages/Admin/ErrorLogPage.tsx' },
  { tableKey: 'hpi', pageFile: 'features/teams/payer-initiatives/components/HpiGallery.tsx' },
  { tableKey: 'payerInquiries', pageFile: 'features/teams/payer-initiatives/components/PayerIssuesGallery.tsx' },
];

describe('tableViewRegistry parity with page columns', () => {
  for (const { tableKey, pageFile } of CASES) {
    it(`${tableKey} registry matches ${pageFile}`, () => {
      const registryTable = TABLE_VIEW_REGISTRY.find((t) => t.tableKey === tableKey);
      expect(registryTable, `TABLE_VIEW_REGISTRY has no entry for '${tableKey}'`).toBeTruthy();

      const pageKeys = new Set(extractKeys(resolve(SRC_ROOT, pageFile)));
      const registryKeys = new Set(registryTable!.columns.map((c) => c.key));
      const allowedRegistryOnly = new Set(REGISTRY_ONLY_ALLOWED[tableKey] ?? []);

      // Every page column must be renameable from admin settings.
      const missingFromRegistry = [...pageKeys].filter((k) => !registryKeys.has(k));
      expect(
        missingFromRegistry,
        `Columns rendered by ${pageFile} but missing from the '${tableKey}' registry ` +
        `(admins cannot rename these): ${missingFromRegistry.join(', ')}`,
      ).toEqual([]);

      // Every registry key must correspond to a real page column, unless explicitly allow-listed.
      const staleInRegistry = [...registryKeys].filter(
        (k) => !pageKeys.has(k) && !allowedRegistryOnly.has(k),
      );
      expect(
        staleInRegistry,
        `Registry keys for '${tableKey}' that no longer exist on ${pageFile} ` +
        `(stale — remove or add to REGISTRY_ONLY_ALLOWED with a reason): ${staleInRegistry.join(', ')}`,
      ).toEqual([]);
    });
  }
});
