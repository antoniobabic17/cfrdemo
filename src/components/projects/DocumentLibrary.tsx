import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Upload, FileText, Trash2, Loader2, Search, X, ArrowUp, ArrowDown,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { cn } from '../../lib/utils';
import {
  listDocuments, listTaskDocumentsForProject, uploadDocumentAndConfirm, deleteDocument, openDocument, formatFileSize, canDeleteDoc,
} from '../../lib/sharePointClient';
import type { DocumentItem, RecordType } from '../../lib/sharePointClient';
import { useEffectiveAdminRole } from '../../providers/ConfigurationProvider';
import { DeleteConfirmDialog } from '../common/DeleteConfirmDialog';
import { useTaskSource } from '../../lib/taskSource';
import { ARTIFACT_STATUS } from '../../lib/constants';
import { useArtifactReadiness } from '../../hooks/useRequiredArtifacts';
import { toast } from '../../hooks/useToast';
import { useChangeAudit } from '../../hooks/useChangeAudit';
import { fmtDateOnly } from '../../lib/dateOnly';
import { FileSourceBadge } from '../common/FileSourceBadge';

interface DocumentLibraryProps {
  recordType: RecordType;
  recordId: string;
  recordName: string;
  projectId?: string;
  programId?: string;
  intakeId?: string;
  taskId?: string;
  compact?: boolean;
  /** When true, hides upload and delete actions -- documents are view-only. */
  readOnly?: boolean;
  /** When provided, also fetch documents for each listed project and merge
   *  them into the displayed list. Each merged row is tagged with the
   *  source project name so the UI can render a 'From: <Project>' chip
   *  and suppress destructive actions on rows the program doesn't own.
   *  Used by ProgramDetailPage to surface child-project documents on the
   *  program's Documents tab. */
  aggregateFromProjects?: { projectId: string; projectName: string }[];
  /**
   * 'default' (implicit) -- normal single-record view. Reads annotations
   *   scoped to (recordType, recordId).
   * 'taskRollup' -- reads every task-scoped attachment across the tasks
   *   supplied via `taskIdsForRollup`. Used by the Plan tab to render a
   *   rolled-up "Task documents" column alongside the project's own
   *   documents. Upload controls are hidden.
   */
  mode?: 'default' | 'taskRollup';
  /** Full list of task ids for the rollup view. Ignored unless mode='taskRollup'. */
  taskIdsForRollup?: string[];
  /** Map of taskId -> task subject, so taskRollup rows can render a
   *  'From: <Task subject>' chip. */
  taskNamesById?: Record<string, string>;
  /** Optional action rendered in the header's right slot (same position as the
   *  normal Upload button). The readOnly Task Documents column passes its own
   *  "Upload to task" button here so both columns' upload controls line up. */
  headerAction?: React.ReactNode;
}

export function DocumentLibrary({
  recordType, recordId, recordName,
  projectId, programId, intakeId, taskId,
  compact, readOnly,
  aggregateFromProjects,
  mode = 'default',
  taskIdsForRollup,
  taskNamesById,
  headerAction,
}: DocumentLibraryProps) {
  // Suppress unused-var noise -- caller-supplied identifiers we keep for
  // API symmetry with the old flow-based signature. These may return as
  // useful once we add "attach to project via task upload" flows.
  void programId; void intakeId; void taskId;

  const auditChange = useChangeAudit();
  // Task documents live on pmo_task under the custom source; other record
  // types are unaffected. Only Task/taskRollup pass this through.
  const customTaskSource = useTaskSource() !== 'pss';
  const qc = useQueryClient();
  const rollupKey = JSON.stringify((taskIdsForRollup ?? []).slice().sort());
  const queryKey = mode === 'taskRollup'
    ? ['annDocs', 'taskRollup', rollupKey, customTaskSource]
    : ['annDocs', recordType, recordId, customTaskSource];

  const { data: documents = [], isPending, error: spError } = useQuery({
    queryKey,
    queryFn: () => mode === 'taskRollup'
      ? listTaskDocumentsForProject(taskIdsForRollup ?? [], customTaskSource)
      : listDocuments({ recordType, recordId }, (recordType === 'Task' || recordType === 'Project') && customTaskSource),
    staleTime: 30_000,
    retry: false,
    enabled: mode === 'taskRollup'
      ? (taskIdsForRollup?.length ?? 0) > 0 || taskIdsForRollup !== undefined
      : !!recordId,
  });

  // Optional aggregation: fetch documents for every child project and tag
  // each row with its source project name so the program's Documents tab
  // shows both program docs and the docs of every project it contains.
  const projectKeyRoot = JSON.stringify((aggregateFromProjects ?? []).map((p) => p.projectId).sort());
  const { data: aggregatedDocs = [], isPending: aggregatedPending } = useQuery({
    queryKey: ['annDocs', 'aggregated', recordId, projectKeyRoot],
    enabled: !!aggregateFromProjects && aggregateFromProjects.length > 0,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const lists = await Promise.all(
        (aggregateFromProjects ?? []).map(async ({ projectId: pid, projectName }) => {
          try {
            const docs = await listDocuments({ recordType: 'Project', recordId: pid }, customTaskSource);
            return docs.map((d) => ({ ...d, sourceProjectId: pid, sourceProjectName: projectName }));
          } catch {
            return [] as typeof documents;
          }
        }),
      );
      return lists.flat();
    },
  });

  const adminRole = useEffectiveAdminRole();
  const isAdmin = adminRole !== 'none';
  const [deletableIds, setDeletableIds] = useState<Set<string>>(new Set());

  // Sort control (rendered in the full view only — see header). Defaults to
  // Modified, newest-first, preserving the prior fixed sort behavior.
  const [sortBy, setSortBy] = useState<'modified' | 'created' | 'name'>('modified');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  const allDocuments = useMemo(() => {
    const merged = [...documents, ...aggregatedDocs];
    const dir = sortDir === 'asc' ? 1 : -1;
    const ts = (v?: string) => (v ? Date.parse(v) || 0 : 0);
    return merged.sort((a, b) => {
      if (sortBy === 'name') {
        return dir * (a.fileName ?? '').localeCompare(b.fileName ?? '');
      }
      const av = sortBy === 'created' ? ts(a.created) : ts(a.modified);
      const bv = sortBy === 'created' ? ts(b.created) : ts(b.modified);
      return dir * (av - bv);
    });
  }, [documents, aggregatedDocs, sortBy, sortDir]);

  // Precompute which docs the current user may delete (creator-or-admin). SP
  // docs are gated client-side via canDeleteDoc; annotation docs stay allowed
  // (Dataverse enforced ownership server-side, preserving prior behavior).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        allDocuments.map(async (d) => (await canDeleteDoc(d, isAdmin)) ? d.annotationId : null),
      );
      if (!cancelled) setDeletableIds(new Set(entries.filter((x): x is string => x !== null)));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(allDocuments.map((d) => d.annotationId)), isAdmin]);

  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  // Filenames whose upload is in flight. The write goes through an async flow
  // (custom API -> Power Automate -> SharePoint), so the file does not exist the
  // instant uploadDocument() resolves. Show a spinning placeholder per pending
  // name and poll listDocuments until it appears (or times out).
  const [pendingUploads, setPendingUploads] = useState<string[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [docToDelete, setDocToDelete] = useState<DocumentItem | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [docSearch, setDocSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showArtifacts = recordType === 'Project' && !!projectId;
  const readiness = useArtifactReadiness(showArtifacts ? projectId : undefined);
  const definitions = readiness?.definitions ?? [];
  const statuses = readiness?.statuses ?? [];

  function openUploadDialog(files: File[]) {
    setPendingFiles(files);
    setUploadDialogOpen(true);
  }

  async function handleUploadConfirm() {
    if (pendingFiles.length === 0) return;
    setUploadDialogOpen(false);
    const files = pendingFiles;
    setPendingFiles([]);
    setPendingUploads((prev) => [...prev, ...files.map((f) => f.name)]);

    for (const file of files) {
      try {
        const { confirmed: landed } = await uploadDocumentAndConfirm(file, { recordType, recordId }, (recordType === 'Task' || recordType === 'Project') && customTaskSource, 12_000);
        if (landed) {
          try {
            auditChange({
              entityType: recordType === 'Task' ? 'task' : 'project',
              entityId: recordId,
              entityName: recordName,
              action: 'update',
              changes: [{ kind: 'relationship', relation: 'document', action: 'add', label: file.name }],
              parentProjectId: projectId,
            });
          } catch { /* best-effort */ }
          toast.success(`Uploaded ${file.name}`);
          qc.invalidateQueries({ queryKey: ['annDocs'] });
        } else {
          // The upload call was accepted but the file never appeared within the
          // confirm budget. The most common cause is that the current user is
          // not a member of the SharePoint AppDocuments document library, so the
          // async flow's write is rejected downstream (the client call still
          // returns "accepted"). Surface a reactive guard pointing them at an
          // admin rather than a misleading "still uploading" message.
          toast.warning(
            `${file.name} hasn’t appeared yet. If it doesn’t show up shortly, check with an admin — you may not have access to the SharePoint document library.`,
            { action: 'update', entityType: recordType === 'Task' ? 'task' : 'project', entityId: recordId },
          );
          qc.invalidateQueries({ queryKey: ['annDocs'] });
        }
      } catch (err) {
        toast.error(`Failed to upload ${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setPendingUploads((prev) => {
          const i = prev.indexOf(file.name);
          if (i === -1) return prev;
          const next = prev.slice();
          next.splice(i, 1);
          return next;
        });
      }
    }
  }

  async function handleDelete(item: DocumentItem) {
    setDeletingId(item.annotationId);
    try {
      await deleteDocument(item);
      qc.invalidateQueries({ queryKey: ['annDocs'] });
      // 2026-07-22: audit doc detach so the project's Change History shows
      // the removal. Best-effort inside try/catch.
      try {
        auditChange({
          entityType: recordType === 'Task' ? 'task' : 'project',
          entityId: recordId,
          entityName: recordName,
          action: 'update',
          changes: [{ kind: 'relationship', relation: 'document', action: 'remove', label: item.fileName }],
          parentProjectId: projectId,
        });
      } catch { /* best-effort */ }
      toast.success(`${item.fileName} deleted`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleOpen(item: DocumentItem) {
    try {
      await openDocument(item);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open file');
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    // In readOnly mode (e.g. the task-rollup column on the Documents tab) we
    // must NOT accept drops. Otherwise the upload dialog opens with a Confirm
    // button that then does nothing because the readOnly guard hides its
    // action. Preventing drop here also matches the operator's directive
    // (2026-07-22) that task-scoped uploads must go through the mandatory
    // task-picker button, not drag/drop.
    if (readOnly) return;
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) openUploadDialog(files);
  }, [readOnly]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (readOnly) return;
    e.preventDefault(); setDragOver(true);
  }, [readOnly]);
  const handleDragLeave = useCallback(() => setDragOver(false), []);

  function renderDocRow(doc: DocumentItem) {
    const isDeleting = deletingId === doc.annotationId;
    const isFromChildProject = !!doc.sourceProjectName;
    return (
      <div key={`${doc.sourceProjectId ?? recordId}::${doc.annotationId}`} className={cn('flex items-center gap-3 rounded-md border border-border px-3 py-2 hover:bg-muted/20 transition-colors', isDeleting && 'opacity-50')}>
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={() => handleOpen(doc)}
            className="text-sm font-medium text-foreground hover:text-primary hover:underline truncate block text-left"
          >
            {doc.fileName}
          </button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
            <FileSourceBadge source={doc.source} />
            {isFromChildProject && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium">
                From: {doc.sourceProjectName}
              </span>
            )}
            {doc.taskId && taskNamesById?.[doc.taskId] && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-medium">
                Task: {taskNamesById[doc.taskId]}
              </span>
            )}
            {doc.fileSizeBytes > 0 && <span>{formatFileSize(doc.fileSizeBytes)}</span>}
            {doc.created && <span>Created {fmtDateOnly(doc.created)}</span>}
            {doc.modified && <span>Modified {fmtDateOnly(doc.modified)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!readOnly && !isFromChildProject && deletableIds.has(doc.annotationId) && (
            <button onClick={() => setDocToDelete(doc)} disabled={isDeleting} className="p-1.5 rounded text-muted-foreground hover:text-destructive" title="Delete">
              {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (spError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <p className="text-sm font-medium text-destructive">Documents unavailable</p>
        <p className="text-xs text-muted-foreground mt-1">{spError instanceof Error ? spError.message : 'Connection failed'}</p>
      </div>
    );
  }

  const aggregationActive = !!aggregateFromProjects && aggregateFromProjects.length > 0;
  if (isPending || (aggregationActive && aggregatedPending)) {
    return (
      <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading documents...</span>
      </div>
    );
  }

  const visibleDocuments = allDocuments.filter((doc) => {
    if (docSearch.trim()) {
      const q = docSearch.trim().toLowerCase();
      return (
        (doc.fileName ?? '').toLowerCase().includes(q) ||
        (doc.sourceProjectName ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-3">
      {/* Artifact readiness pills */}
      {showArtifacts && definitions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {definitions.filter((d) => d.pmo_isrequired).map((def) => {
            const status = statuses.find((s) => s['_pmo_requiredartifact_value'] === def.pmo_requiredartifactid);
            const done = status && (status.pmo_status === ARTIFACT_STATUS.Complete || status.pmo_status === ARTIFACT_STATUS.Waived);
            return (
              <span key={def.pmo_requiredartifactid} className={cn(
                'text-[10px] font-medium px-2 py-0.5 rounded-full',
                done ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
              )}>
                {def.pmo_name}
              </span>
            );
          })}
        </div>
      )}

      {/* Search bar */}
      {allDocuments.length > 0 && (
        <div className="relative max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={docSearch}
            onChange={(e) => setDocSearch(e.target.value)}
            placeholder="Search documents…"
            className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {docSearch && (
            <button
              type="button"
              onClick={() => setDocSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {visibleDocuments.length !== allDocuments.length
            ? `${visibleDocuments.length} of ${allDocuments.length} document${allDocuments.length !== 1 ? 's' : ''}`
            : `${allDocuments.length} document${allDocuments.length !== 1 ? 's' : ''}`}
          {aggregateFromProjects && aggregateFromProjects.length > 0 && documents.length !== allDocuments.length && (
            <span className="ml-1">({documents.length} program, {allDocuments.length - documents.length} from projects)</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {/* Sort control — full view only (hidden in compact + task-rollup
              embeds so those stay lean). Sorts by created/modified/name. */}
          {!compact && mode !== 'taskRollup' && allDocuments.length > 1 && (
            <div className="flex items-center gap-1">
              <select
                aria-label="Sort documents by"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'modified' | 'created' | 'name')}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="modified">Modified On</option>
                <option value="created">Created On</option>
                <option value="name">Name</option>
              </select>
              <button
                type="button"
                onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:text-foreground"
                title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
                aria-label={sortDir === 'asc' ? 'Sort ascending' : 'Sort descending'}
              >
                {sortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
              </button>
            </div>
          )}
          {!readOnly && (
            <>
              <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={pendingUploads.length > 0}>
                <Upload className="h-3.5 w-3.5 mr-1" />
                Upload
              </Button>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length > 0) openUploadDialog(files);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }} />
            </>
          )}
          {/* Caller-supplied header action (Task Documents column's "Upload to
              task" button) — same slot as Upload so both columns align. */}
          {headerAction}
        </div>
      </div>

      {/* Drop zone (full mode only) */}
      {!compact && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={cn(
            'rounded-lg border-2 border-dashed text-center transition-colors',
            dragOver ? 'border-primary bg-primary/5 p-6' : 'border-border',
            allDocuments.length > 0 && !dragOver ? 'p-3' : 'p-6',
          )}
        >
          {allDocuments.length === 0 && !dragOver ? (
            <div>
              <Upload className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Drag and drop files here, or use the Upload button</p>
            </div>
          ) : dragOver ? (
            <p className="text-sm text-primary font-medium">Drop files to upload</p>
          ) : null}
        </div>
      )}

      {/* Pending uploads — spinning placeholders while the async flow writes
          the file to SharePoint. Removed once listDocuments confirms it. */}
      {pendingUploads.length > 0 && (
        <div className="space-y-1">
          {pendingUploads.map((name, i) => (
            <div key={`pending::${name}::${i}`} className="flex items-center gap-3 rounded-md border border-border border-dashed px-3 py-2 bg-muted/10">
              <Loader2 className="h-4 w-4 text-muted-foreground shrink-0 animate-spin" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-muted-foreground truncate block">{name}</span>
                <span className="text-xs text-muted-foreground/70">Uploading to SharePoint…</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Document list */}
      {allDocuments.length > 0 ? (
        <div className="space-y-1">{visibleDocuments.map((doc) => renderDocRow(doc))}</div>
      ) : null}

      {/* Delete confirm dialog — type-to-confirm the file name, same pattern
          as project/task deletion. */}
      <DeleteConfirmDialog
        open={docToDelete !== null}
        onOpenChange={(o) => { if (!o) setDocToDelete(null); }}
        title="Delete document"
        recordName={docToDelete?.fileName ?? ''}
        onConfirm={async () => {
          if (docToDelete) { const d = docToDelete; setDocToDelete(null); await handleDelete(d); }
        }}
        extraWarning="This permanently removes the file. This cannot be undone."
      />

      {/* Upload confirm dialog */}
      <Dialog open={uploadDialogOpen} onOpenChange={(o) => { if (!o) { setUploadDialogOpen(false); setPendingFiles([]); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upload {pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''}</DialogTitle>
            <DialogDescription>Confirm the file{pendingFiles.length > 1 ? 's' : ''} to upload.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {pendingFiles.map((f, i) => (
              <p key={i} className="text-sm text-foreground flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                {f.name} <span className="text-xs text-muted-foreground">({formatFileSize(f.size)})</span>
              </p>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setUploadDialogOpen(false); setPendingFiles([]); }}>Cancel</Button>
            <Button onClick={handleUploadConfirm}>
              <Upload className="h-3.5 w-3.5 mr-1" />Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
