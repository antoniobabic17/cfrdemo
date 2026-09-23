/**
 * FileSourceBadge — small pill indicating where a file is physically stored.
 *
 * Three variants:
 *   FileSourceBadge source="sharepoint"  → blue  "SharePoint"
 *   FileSourceBadge source="annotation"  → gray  "Dataverse"
 *   LegacyFileBadge                      → amber "Legacy"  (Dataverse File-column;
 *                                          distinct from annotation rows)
 *
 * All file rows in the app carry a DocumentItem.source field already set by
 * spToItem() or annotationToItem() in sharePointClient.ts. LegacyFileBadge is
 * used by PayerIssueAttachments for the seven cr87a File-column slots that pre-
 * date the app's document system.
 */

interface FileSourceBadgeProps {
  source?: 'annotation' | 'sharepoint';
}

export function FileSourceBadge({ source }: FileSourceBadgeProps) {
  if (source === 'sharepoint') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200 text-[10px] font-medium shrink-0">
        SharePoint
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium shrink-0">
      Dataverse
    </span>
  );
}

export function LegacyFileBadge() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200 text-[10px] font-medium shrink-0">
      Legacy
    </span>
  );
}
