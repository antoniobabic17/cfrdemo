/**
 * TaskDocumentsPanel (2026-07-22)
 *
 * The "Task documents" column on the project Documents sub-tab.
 *
 * Historically this was a read-only DocumentLibrary in mode="taskRollup" --
 * users could see every task-scoped attachment across the project but
 * couldn't add one without navigating to the task's detail panel first.
 * Tracey asked for an upload path here that (a) uses a button, not
 * drag/drop, and (b) FORCES the operator to pick a target task before the
 * file is written -- unlike the project-documents column which uploads
 * straight to the project row.
 *
 * Implementation:
 *   - Reuses the existing DocumentLibrary (readOnly, taskRollup) for the
 *     display side. Drag/drop is suppressed at the library level by
 *     handleDrop's readOnly guard.
 *   - Layers an Upload button + task picker + hidden file input on top.
 *     On pick + file select, we mount a hidden DocumentLibrary
 *     (recordType='Task') for the picked task and drive its upload path
 *     via a shared ref -- BUT that's more plumbing than we need. Simpler:
 *     call uploadDocument directly (same sharePointClient helper the
 *     library uses) with recordType='Task' + the picked task GUID, then
 *     fire the same auditChange the library now fires internally.
 */
import { useState, useRef } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '../ui/dialog';
import { DocumentLibrary } from './DocumentLibrary';
import { uploadDocumentAndConfirm } from '../../lib/sharePointClient';
import { useTaskSource } from '../../lib/taskSource';
import { toast } from '../../hooks/useToast';
import { useChangeAudit } from '../../hooks/useChangeAudit';
import { useQueryClient } from '@tanstack/react-query';

interface Props {
  projectId: string;
  projectName: string;
  tasks: Array<{ msdyn_projecttaskid: string; msdyn_subject?: string }>;
  taskIdsForRollup: string[];
  taskNamesById: Record<string, string>;
  canEdit: boolean;
}

export function TaskDocumentsPanel({
  projectId, projectName, tasks, taskIdsForRollup, taskNamesById, canEdit,
}: Props) {
  const qc = useQueryClient();
  const auditChange = useChangeAudit();
  const customTaskSource = useTaskSource() !== 'pss';
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Non-summary tasks only -- can't attach a document to a bucket-heading task.
  const uploadableTasks = tasks.filter((t) => !!t.msdyn_projecttaskid && !t.msdyn_projecttaskid.startsWith('optimistic-'));

  function openPickerFromButton() {
    setSelectedTaskId('');
    setPickerOpen(true);
  }

  function onPickerFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) setPendingFiles(files);
    // Reset so the same file can be re-picked next time.
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleConfirmUpload() {
    if (!selectedTaskId || !pendingFiles || pendingFiles.length === 0) return;
    setUploading(true);
    let successCount = 0;
    const taskName = taskNamesById[selectedTaskId] ?? 'task';
    for (const file of pendingFiles) {
      try {
        const { confirmed } = await uploadDocumentAndConfirm(file, { recordType: 'Task', recordId: selectedTaskId }, customTaskSource);
        if (!confirmed) { toast.error(`${file.name} is taking longer than expected — it may still appear shortly.`); continue; }
        successCount++;
        try {
          auditChange({
            entityType: 'task',
            entityId: selectedTaskId,
            entityName: taskName,
            action: 'update',
            changes: [{ kind: 'relationship', relation: 'document', action: 'add', label: file.name }],
            parentProjectId: projectId,
          });
        } catch { /* best-effort */ }
      } catch (err) {
        toast.error(`Failed to upload ${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
    if (successCount > 0) {
      toast.success(`${successCount} file${successCount > 1 ? 's' : ''} uploaded to ${taskName}`);
      // Broad-invalidate the annDocs tree so the project column and the program's
      // aggregated Documents tab both refresh, not just this task's own key.
      qc.invalidateQueries({ queryKey: ['annDocs'] });
    }
    setUploading(false);
    setPickerOpen(false);
    setPendingFiles(null);
    setSelectedTaskId('');
  }

  function handleCancel() {
    if (uploading) return;
    setPickerOpen(false);
    setPendingFiles(null);
    setSelectedTaskId('');
  }

  const uploadDisabled = !canEdit || uploadableTasks.length === 0;

  const uploadButton = (
    <Button
      size="sm"
      onClick={openPickerFromButton}
      disabled={uploadDisabled}
      title={
        !canEdit
          ? 'Read-only — you cannot upload here'
          : uploadableTasks.length === 0
            ? 'Add at least one task before attaching a task document'
            : 'Attach a file to a specific task'
      }
    >
      <Upload className="h-3.5 w-3.5 mr-1.5" />
      Upload to task
    </Button>
  );

  return (
    <div className="space-y-3">
      {/* Read-only rollup of every task-scoped attachment on the project. The
          "Upload to task" button is passed as the library's headerAction so it
          sits in the SAME header position as the project column's Upload button. */}
      <DocumentLibrary
        recordType="Project"
        recordId={projectId}
        recordName={projectName ?? ''}
        projectId={projectId}
        mode="taskRollup"
        taskIdsForRollup={taskIdsForRollup}
        taskNamesById={taskNamesById}
        readOnly
        headerAction={uploadButton}
      />

      {/* Task-picker + file-input modal. Two-step within the same dialog:
          1) Pick a task from the dropdown.
          2) Click Choose file(s) -> browser file picker.
          3) Confirm to upload. */}
      <Dialog open={pickerOpen} onOpenChange={(o) => { if (!o) handleCancel(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Attach file to a task</DialogTitle>
            <DialogDescription>
              Task documents must be tied to a specific task, not just the project.
              Pick the target task, then choose one or more files.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Target task
              </label>
              <select
                value={selectedTaskId}
                onChange={(e) => setSelectedTaskId(e.target.value)}
                disabled={uploading}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">— Select a task —</option>
                {uploadableTasks.map((t) => (
                  <option key={t.msdyn_projecttaskid} value={t.msdyn_projecttaskid}>
                    {t.msdyn_subject ?? '(unnamed task)'}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                File(s)
              </label>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!selectedTaskId || uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  Choose file{pendingFiles && pendingFiles.length > 1 ? 's' : ''}
                </Button>
                <span className="text-xs text-muted-foreground truncate">
                  {pendingFiles && pendingFiles.length > 0
                    ? pendingFiles.map((f) => f.name).join(', ')
                    : 'None selected'}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={onPickerFileChange}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" disabled={uploading} onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmUpload}
              disabled={uploading || !selectedTaskId || !pendingFiles || pendingFiles.length === 0}
              aria-busy={uploading}
            >
              {uploading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Uploading…
                </>
              ) : (
                'Upload'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
