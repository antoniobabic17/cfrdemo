/**
 * T032 — evidence mounts, and exactly one parent per row.
 *
 * The registry test is the one that keeps this honest over time: it asserts the mount
 * configuration covers exactly the seven parent kinds the attachment table has lookups
 * for, so an eighth parent added to the table fails here rather than shipping a record
 * type nobody can attach evidence to.
 *
 * The exactly-one-parent tests drive the REAL service function. FR-033 cannot be enforced
 * by the platform — nothing in Dataverse expresses "exactly one of these eight" — so the
 * guard is application code, and application code that is not tested in both directions is
 * a comment. Zero parents is tested as carefully as two: a parentless row is invisible on
 * every panel and still occupies the library, which is the quieter of the two failures.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const dvCreate = vi.fn();
vi.mock('../../../lib/dataverseClient', () => ({
  list: vi.fn(), get: vi.fn(), update: vi.fn(), deactivate: vi.fn(),
  create: (...a: unknown[]) => dvCreate(...a),
}));

const panelProps: Record<string, unknown>[] = [];
vi.mock('./UatAttachmentPanel', () => ({
  UatAttachmentPanel: (props: Record<string, unknown>) => {
    panelProps.push(props);
    return <div data-testid="panel">{String(props.heading)}</div>;
  },
}));

import { UatEvidenceFor, UAT_EVIDENCE_MOUNTS, MOUNTED_PARENTS } from './UatAttachmentMounts';
import { createUatAttachment } from '../../../api/uatProjectSettings.api';
import { UAT_ATTACHMENT_CATEGORY, UAT_PARENT_TYPE } from '../../../lib/uatOptionSets';
import {
  UAT_EVIDENCE_PARENTS,
  UAT_PARENT_BIND_KEYS,
  UAT_PARENT_TYPE_FOR_BIND,
} from '../lib/uatEvidence';
import type { UatAttachmentCreate } from '../../../models/uatDefect.model';

const base = (): UatAttachmentCreate => ({
  pmo_filename: 'shot.png',
  pmo_filesizebytes: 2048,
  pmo_category: UAT_ATTACHMENT_CATEGORY.Screenshot,
});

beforeEach(() => {
  vi.clearAllMocks();
  panelProps.length = 0;
  dvCreate.mockResolvedValue({ pmo_uatattachmentid: 'a-1' });
});

describe('the mount registry covers every parent the table has a lookup for', () => {
  it('configures exactly the seven parent kinds', () => {
    expect(Object.keys(UAT_EVIDENCE_MOUNTS).sort()).toEqual([...UAT_EVIDENCE_PARENTS].sort());
    expect(MOUNTED_PARENTS).toHaveLength(7);
  });

  it('names a heading and a default category for each', () => {
    for (const parent of UAT_EVIDENCE_PARENTS) {
      const config = UAT_EVIDENCE_MOUNTS[parent];
      expect(config.heading.length).toBeGreaterThan(0);
      expect(typeof config.defaultCategory).toBe('number');
    }
  });

  it('defaults each parent to the category a file dropped there actually is', () => {
    // A shared default cannot express this: a file on a defect is defect evidence, one on
    // an import batch is the import source.
    expect(UAT_EVIDENCE_MOUNTS.Defect.defaultCategory).toBe(UAT_ATTACHMENT_CATEGORY.DefectEvidence);
    expect(UAT_EVIDENCE_MOUNTS.ImportBatch.defaultCategory).toBe(UAT_ATTACHMENT_CATEGORY.ImportSource);
    expect(UAT_EVIDENCE_MOUNTS.TestRun.defaultCategory).toBe(UAT_ATTACHMENT_CATEGORY.TestEvidence);
  });

  it('renders a panel configured from the registry, for every parent kind', () => {
    for (const parent of UAT_EVIDENCE_PARENTS) {
      const { unmount } = render(<UatEvidenceFor parent={parent} recordId="r-1" projectId="p-1" />);
      const props = panelProps[panelProps.length - 1];
      expect(props.parent).toBe(parent);
      expect(props.parentId).toBe('r-1');
      expect(props.projectId).toBe('p-1');
      expect(props.heading).toBe(UAT_EVIDENCE_MOUNTS[parent].heading);
      expect(props.defaultCategory).toBe(UAT_EVIDENCE_MOUNTS[parent].defaultCategory);
      unmount();
    }
    expect(panelProps).toHaveLength(7);
  });

  it('passes read-only through rather than deciding it', () => {
    render(<UatEvidenceFor parent="Cycle" recordId="c-1" readOnly />);
    expect(panelProps[0].readOnly).toBe(true);
    expect(screen.getByTestId('panel').textContent).toBe(UAT_EVIDENCE_MOUNTS.Cycle.heading);
  });
});

describe('the surfaces that exist today actually mount it', () => {
  /**
   * Source-text guards rather than full page renders. The claim is REACHABILITY — that these
   * pages render the panel at all — and the pages themselves are covered elsewhere. A green
   * component test proves the panel works; it says nothing about whether anything shows it,
   * which is the failure this catches.
   */
  const sources = import.meta.glob(
    [
      '../pages/TestCaseDetailPage.tsx',
      '../pages/ProjectUatTab.tsx',
      './TestRunFormBody.tsx',
    ],
    { query: '?raw', import: 'default', eager: true },
  ) as Record<string, string>;

  const sourceFor = (name: string) =>
    Object.entries(sources).find(([path]) => path.endsWith(name))?.[1] ?? '';

  it('mounts the test case\'s own evidence on its detail page', () => {
    const source = sourceFor('TestCaseDetailPage.tsx');
    expect(source).toContain("from '../components/UatAttachmentMounts'");
    expect(source).toContain('<UatEvidenceFor parent="TestCase"');
  });

  it('mounts the run\'s evidence inside the run form, while the run is open', () => {
    const source = sourceFor('TestRunFormBody.tsx');
    expect(source).toContain("from './UatAttachmentMounts'");
    expect(source).toContain('parent="TestRun"');
    // The run's own id, not the case's — evidence belongs to the attempt that saw it.
    expect(source).toContain('recordId={run.pmo_uattestrunid}');
  });

  it('mounts the project\'s own UAT evidence on the project tab', () => {
    const source = sourceFor('ProjectUatTab.tsx');
    expect(source).toContain("from '../components/UatAttachmentMounts'");
    expect(source).toContain('<UatEvidenceFor parent="Project"');
  });
});

describe('exactly one parent lookup, enforced in the service layer (FR-033)', () => {
  it('accepts a row for each of the eight bind keys, one at a time', async () => {
    for (const key of UAT_PARENT_BIND_KEYS) {
      dvCreate.mockClear();
      await createUatAttachment({ ...base(), [key]: '/pmo_uattestcases(x)' } as UatAttachmentCreate);
      expect(dvCreate).toHaveBeenCalledTimes(1);
    }
  });

  it('refuses a row with two parents set', async () => {
    await expect(createUatAttachment({
      ...base(),
      'pmo_TestCase@odata.bind': '/pmo_uattestcases(tc-1)',
      'pmo_Defect@odata.bind': '/pmo_uatdefects(d-1)',
    })).rejects.toThrow(/exactly one parent record; 2 were set/);
    expect(dvCreate).not.toHaveBeenCalled();
  });

  it('refuses a row with BOTH project lookups set', async () => {
    // The two project binds are one parent expressed two ways. Setting both is how a row
    // gets counted twice by a reader that matches either.
    await expect(createUatAttachment({
      ...base(),
      'pmo_Project@odata.bind': '/msdyn_projects(p-1)',
      'pmo_ProjectRef@odata.bind': '/pmo_projects(p-1)',
    })).rejects.toThrow(/2 were set/);
    expect(dvCreate).not.toHaveBeenCalled();
  });

  it('refuses a parentless row as loudly as a double-parented one', async () => {
    await expect(createUatAttachment(base())).rejects.toThrow(/none was set/);
    expect(dvCreate).not.toHaveBeenCalled();
  });

  it('treats an explicit null or empty bind as absent, not as a parent', async () => {
    await expect(createUatAttachment({
      ...base(),
      'pmo_TestCase@odata.bind': null,
      'pmo_Defect@odata.bind': '',
    })).rejects.toThrow(/none was set/);
  });

  it('refuses a parent-type filter key that disagrees with the lookup', async () => {
    // pmo_parenttype is denormalized. One that disagrees with the lookup is worse than none:
    // reports read the key, panels read the lookup, and they would answer differently.
    await expect(createUatAttachment({
      ...base(),
      pmo_parenttype: UAT_PARENT_TYPE.Defect,
      'pmo_TestCase@odata.bind': '/pmo_uattestcases(tc-1)',
    })).rejects.toThrow(/does not match its parent lookup/);
    expect(dvCreate).not.toHaveBeenCalled();
  });

  it('accepts the matching parent type for every bind key', async () => {
    for (const key of UAT_PARENT_BIND_KEYS) {
      dvCreate.mockClear();
      await createUatAttachment({
        ...base(),
        pmo_parenttype: UAT_PARENT_TYPE_FOR_BIND[key],
        [key]: '/x(1)',
      } as UatAttachmentCreate);
      expect(dvCreate).toHaveBeenCalledTimes(1);
    }
  });

  it('accepts either project bind against the one Project parent type', async () => {
    // Both map to the same integer: which lookup a row uses is a data-source-mode detail,
    // not a different kind of parent.
    expect(UAT_PARENT_TYPE_FOR_BIND['pmo_Project@odata.bind'])
      .toBe(UAT_PARENT_TYPE_FOR_BIND['pmo_ProjectRef@odata.bind']);
  });
});
