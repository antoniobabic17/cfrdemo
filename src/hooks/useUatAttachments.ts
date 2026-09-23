/**
 * UAT evidence hooks — the metadata row, and the library read that gives it a link.
 *
 * Every write routes through useAppMutation; see useUatTemplates.ts's header for why.
 * A SharePoint failure MUST reach the tester as a failure here, which is exactly what
 * the wrapper does with it. Nothing in this file catches an upload error.
 *
 * TWO READS, ONE ROUND TRIP EACH, and the reason is not symmetry:
 *
 *   1. `pmo_uatattachment` rows — the authoritative set of what is attached, with the
 *      category, the uploader and the parent. Queryable and reportable alongside the
 *      rest of the UAT data (FR-032), with no per-row round trip to the library.
 *   2. ONE paged library read per record, to resolve each row's item id and link.
 *
 * The second exists because `pmo_UploadDocumentToSharePoint` returns no item metadata —
 * the action answers "accepted", not "here is item 3330". So a freshly created metadata
 * row has an empty item id and no URL, and a list built from Dataverse alone could name
 * the files but not open one. Matching is by file name, which is safe because
 * `uniqueFileName` has already made names unique within a record. One list read for the
 * whole panel is not a per-row round trip.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import { useDataSource } from '../lib/taskSource';
import {
  listUatAttachmentsByParent,
  createUatAttachment,
  deleteUatAttachment,
} from '../api/uatProjectSettings.api';
import {
  listUatEvidence,
  uploadUatEvidence,
  deleteUatEvidence,
  uatParentBind,
  UAT_PARENT_VALUE_COLUMN,
  type UatEvidenceParent,
} from '../features/uat/lib/uatEvidence';
import type { UatAttachmentCategoryValue } from '../lib/uatOptionSets';
import type { UatAttachment } from '../models/uatDefect.model';

const EVIDENCE_QK = (parent: UatEvidenceParent, parentId: string) =>
  ['uatEvidence', parent, parentId] as const;
const LIBRARY_QK = (parent: UatEvidenceParent, parentId: string) =>
  ['uatEvidenceLibrary', parent, parentId] as const;

/** A metadata row joined to whatever the library knows about the same file. */
export interface UatEvidenceItem {
  row: UatAttachment;
  /** The library item id — '' until the library read has matched this row. */
  itemId: string;
  /** The direct SharePoint URL, or undefined when the library read has not matched. */
  link?: string;
}

export interface UatEvidenceList {
  items: UatEvidenceItem[];
  /** True when the library read could not be paged to the end — see SpDocumentPage. */
  truncated: boolean;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  /** A library read failing must not hide the metadata rows; this says it happened. */
  linksUnavailable: boolean;
}

/**
 * One record's evidence: the metadata rows, each carrying its library link when the
 * library read resolved it.
 *
 * The two queries are deliberately independent. A library outage leaves the tester
 * looking at the correct list of file names with the open action unavailable and a
 * stated reason — strictly better than an empty panel that implies nothing is attached.
 */
export function useUatEvidence(
  parent: UatEvidenceParent,
  parentId: string | undefined,
): UatEvidenceList {
  const rowsQuery = useQuery({
    queryKey: EVIDENCE_QK(parent, parentId ?? ''),
    queryFn: () => listUatAttachmentsByParent(UAT_PARENT_VALUE_COLUMN[parent], parentId!),
    enabled: !!parentId,
    staleTime: 30_000,
  });

  const libraryQuery = useQuery({
    queryKey: LIBRARY_QK(parent, parentId ?? ''),
    queryFn: () => listUatEvidence(parent, parentId!),
    enabled: !!parentId,
    staleTime: 30_000,
    retry: false,
  });

  const byName = new Map<string, { itemId: string; link?: string }>();
  for (const doc of libraryQuery.data?.documents ?? []) {
    // First writer wins: two library items with one name should not happen (see
    // uniqueFileName) and if it does, the older one is the row that was recorded.
    if (!byName.has(doc.fileName.toLowerCase())) {
      byName.set(doc.fileName.toLowerCase(), { itemId: doc.itemId, link: doc.link });
    }
  }

  const items: UatEvidenceItem[] = (rowsQuery.data ?? []).map((row) => {
    const hit = byName.get((row.pmo_filename ?? '').toLowerCase());
    return {
      row,
      // The row's own stored values first — a backfilled row should not need the library.
      itemId: row.pmo_sharepointitemid || hit?.itemId || '',
      link: row.pmo_sharepointweburl || hit?.link,
    };
  });

  return {
    items,
    truncated: libraryQuery.data?.truncated ?? false,
    isPending: rowsQuery.isPending,
    isError: rowsQuery.isError,
    error: rowsQuery.error,
    linksUnavailable: libraryQuery.isError,
  };
}

export interface AttachUatEvidenceVars {
  file: File;
  category: UatAttachmentCategoryValue;
  description?: string | null;
}

/**
 * Attach one file: upload the bytes, then record the metadata row.
 *
 * ORDER MATTERS AND IS NOT REVERSIBLE. The upload happens first, so a metadata row only
 * ever exists for a file that is really in the library. The other order would produce a
 * row pointing at nothing whenever the upload failed — a phantom attachment, which is
 * worse than no attachment because it looks like evidence.
 *
 * The residual case is the reverse: an upload that succeeds and a metadata write that
 * fails leaves a file in the library with no row. That surfaces as a failed action the
 * tester can retry, and the retry is harmless — `uniqueFileName` suffixes rather than
 * overwriting, so nothing is lost. An orphan file is recoverable; a phantom row is a
 * lie.
 */
export function useAttachUatEvidence(
  parent: UatEvidenceParent,
  parentId: string,
  projectId?: string,
) {
  const qc = useQueryClient();
  const dataSource = useDataSource();
  return useAppMutation({
    action: 'attach UAT evidence',
    entityType: 'pmo_uatattachment',
    parentProjectId: projectId,
    mutationFn: async ({ file, category, description }: AttachUatEvidenceVars) => {
      const { metadata } = await uploadUatEvidence({ parent, parentId, file, category });
      return createUatAttachment({
        ...metadata,
        pmo_description: description ?? null,
        ...uatParentBind(parent, parentId, dataSource),
      });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: EVIDENCE_QK(parent, parentId) });
      void qc.invalidateQueries({ queryKey: LIBRARY_QK(parent, parentId) });
    },
  });
}

/**
 * Detach one file: deactivate the metadata row, then remove the library item.
 *
 * The row goes first on purpose. If the library delete fails, the tester sees the
 * attachment gone from the record — which is what they asked for — and an orphan file
 * remains in the library, where it is inert. Deleting the file first and then failing to
 * deactivate the row would leave a row whose link 404s: the phantom again.
 *
 * A row with no resolved item id deactivates and stops there. That is not an error: the
 * library read may simply not have matched, and refusing the detach would strand the row.
 */
export function useDetachUatEvidence(
  parent: UatEvidenceParent,
  parentId: string,
  projectId?: string,
) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'remove UAT evidence',
    entityType: 'pmo_uatattachment',
    entityId: (vars: UatEvidenceItem) => vars.row.pmo_uatattachmentid,
    parentProjectId: projectId,
    mutationFn: async (item: UatEvidenceItem) => {
      await deleteUatAttachment(item.row.pmo_uatattachmentid);
      if (item.itemId) await deleteUatEvidence(item.itemId);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: EVIDENCE_QK(parent, parentId) });
      void qc.invalidateQueries({ queryKey: LIBRARY_QK(parent, parentId) });
    },
  });
}
