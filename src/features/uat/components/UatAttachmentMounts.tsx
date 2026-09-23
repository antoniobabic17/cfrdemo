/**
 * UatAttachmentMounts — where evidence attaches, declared once.
 *
 * ONE REGISTRY, SEVEN PARENTS. Each parent kind's heading and default category live here,
 * and every surface renders `<UatEvidenceFor parent="…" />` rather than configuring a
 * panel of its own. The alternative — each page passing its own props — is how a heading
 * reads "Evidence" on one record and "Attachments" on another, and how the defect page
 * ends up defaulting screenshots to the wrong category. A test asserts the registry covers
 * exactly the seven kinds, so adding an eighth parent to the table fails the build here
 * rather than shipping a record type nobody can attach to.
 *
 * THE DEFAULT CATEGORY IS PER PARENT for a reason a shared default cannot express: a file
 * dragged onto a defect is defect evidence, one dragged onto a run is test evidence, and a
 * file on an import batch is the import source. A pasted image is always a screenshot
 * whatever the parent — that override lives in the panel, because it follows from HOW the
 * file arrived rather than from WHERE.
 */
import { UatAttachmentPanel } from './UatAttachmentPanel';
import { UAT_ATTACHMENT_CATEGORY } from '../../../lib/uatOptionSets';
import type { UatAttachmentCategoryValue } from '../../../lib/uatOptionSets';
import { UAT_EVIDENCE_PARENTS, type UatEvidenceParent } from '../lib/uatEvidence';

interface MountConfig {
  heading: string;
  defaultCategory: UatAttachmentCategoryValue;
}

export const UAT_EVIDENCE_MOUNTS: Record<UatEvidenceParent, MountConfig> = {
  TestCase:    { heading: 'Evidence',        defaultCategory: UAT_ATTACHMENT_CATEGORY.TestEvidence },
  TestRun:     { heading: 'Run evidence',    defaultCategory: UAT_ATTACHMENT_CATEGORY.TestEvidence },
  Defect:      { heading: 'Defect evidence', defaultCategory: UAT_ATTACHMENT_CATEGORY.DefectEvidence },
  Requirement: { heading: 'Evidence',        defaultCategory: UAT_ATTACHMENT_CATEGORY.TestEvidence },
  Cycle:       { heading: 'Cycle evidence',  defaultCategory: UAT_ATTACHMENT_CATEGORY.SignOff },
  Project:     { heading: 'UAT evidence',    defaultCategory: UAT_ATTACHMENT_CATEGORY.SignOff },
  ImportBatch: { heading: 'Import source',   defaultCategory: UAT_ATTACHMENT_CATEGORY.ImportSource },
};

/** Every parent kind the registry configures — for the coverage assertion. */
export const MOUNTED_PARENTS = UAT_EVIDENCE_PARENTS;

export interface UatEvidenceForProps {
  parent: UatEvidenceParent;
  /** The parent record's id. Undefined before it is saved; the panel says so. */
  recordId: string | undefined;
  /** The project the record belongs to — telemetry context on every failure. */
  projectId?: string;
  readOnly?: boolean;
}

/**
 * The evidence panel for one record, configured from the registry.
 *
 * A thin component on purpose: it exists so no page holds panel configuration, which is
 * what makes "all seven parents behave the same way" structural instead of reviewed.
 */
export function UatEvidenceFor({ parent, recordId, projectId, readOnly }: UatEvidenceForProps) {
  const config = UAT_EVIDENCE_MOUNTS[parent];
  return (
    <UatAttachmentPanel
      parent={parent}
      parentId={recordId}
      projectId={projectId}
      heading={config.heading}
      defaultCategory={config.defaultCategory}
      readOnly={readOnly}
    />
  );
}

export default UatEvidenceFor;
