/**
 * Keep the file the operator actually uploaded, attached to its batch.
 *
 * **Why this is worth doing at all.** A batch records what each row became; it does not
 * record what the operator handed over. Six weeks later, "row 42 failed because the Cycle
 * did not resolve" is only actionable if the file that held row 42 still exists — and the
 * copy on someone's laptop has been edited since. The archive is the evidence.
 *
 * **It goes through the evidence path, not a second one.** Same `uploadUatEvidence`, same
 * library, same `pmo_uatattachment` metadata row, parented on the import batch (the seventh
 * parent kind, which is why there are seven). Categorised Import Source, which is what makes
 * it distinguishable from a screenshot on the same batch.
 *
 * **A failed archive must never fail an import.** The rows are staged and countable before
 * this runs; losing the source copy is a real loss and a smaller one than refusing an import
 * the operator has already reviewed. So the caller is handed an outcome rather than an
 * exception, and the batch page says whether the file is there.
 */
import { createUatAttachment } from '../../../api/uatProjectSettings.api';
import type { DataSource } from '../../../lib/taskSource';
import { UAT_ATTACHMENT_CATEGORY } from '../../../lib/uatOptionSets';
import {
  uploadUatEvidence,
  uatParentBind,
  evidenceRejectionReason,
} from './uatEvidence';

export interface ArchiveImportSourceInput {
  batchId: string;
  file: File;
  dataSource: DataSource;
}

export type ArchiveOutcome =
  | { archived: true }
  | { archived: false; reason: string };

/**
 * Attach the uploaded file to its batch. Never throws.
 *
 * The size check runs first and shares the evidence cap — the same number the parser
 * enforces, which is why a file this import accepted can always be archived (T034 reuses
 * `UAT_MAX_FILE_BYTES` for exactly this reason).
 */
export async function archiveImportSource(
  input: ArchiveImportSourceInput,
): Promise<ArchiveOutcome> {
  const rejection = evidenceRejectionReason(input.file);
  if (rejection) return { archived: false, reason: rejection };

  try {
    const { metadata } = await uploadUatEvidence({
      parent: 'ImportBatch',
      parentId: input.batchId,
      file: input.file,
      category: UAT_ATTACHMENT_CATEGORY.ImportSource,
    });
    await createUatAttachment({
      ...metadata,
      pmo_description: 'The file this import was created from.',
      ...uatParentBind('ImportBatch', input.batchId, input.dataSource),
    });
    return { archived: true };
  } catch (error) {
    // Reported, not thrown. The import itself has already succeeded or failed on its own
    // terms, and an exception here would undo a decision the operator already made.
    return {
      archived: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
