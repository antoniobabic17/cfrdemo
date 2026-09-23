import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/layout/PageHeader';
import { DataTable, type DataTableColumn } from '../../components/data-table';
import { StatusBadge } from '../../components/common/StatusBadge';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { DeleteConfirmDialog } from '../../components/common/DeleteConfirmDialog';
import { useUserFeedback, useUpdateUserFeedback } from '../../hooks/useUserFeedback';
import { useViewExtraSelect } from '../../hooks/useViewExtraSelect';
import { useEffectiveAdminRole } from '../../providers/ConfigurationProvider';
import { deleteUserFeedback } from '../../api/userFeedback.api';
import type { UserFeedback } from '../../models/userFeedback.model';
import { FEEDBACK_TYPE, FEEDBACK_STATUS, FEEDBACK_PRIORITY } from '../../lib/constants';
import { Bug, Lightbulb, MessageSquareText, Trash2, Loader2 } from 'lucide-react';
import { toast } from '../../hooks/useToast';
import { useFeedbackSaving, useFeedbackSavingSet } from '../../lib/feedbackSaveStore';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { useUserSearch } from '../../hooks/useIntakeLookups';
import { useCurrentUserId } from '../../hooks/useCurrentUserId';
import { emitFeedbackAssigned } from '../../lib/notify';
import { fmtDateOnly } from '../../lib/dateOnly';
import { useEffectiveFeatureToggles } from '../../hooks/useEffectiveFeatureToggles';

const TYPE_LABELS: Record<number, string> = {
  [FEEDBACK_TYPE.BugReport]: 'Bug Report',
  [FEEDBACK_TYPE.Enhancement]: 'Enhancement',
};

const STATUS_LABELS: Record<number, string> = {
  [FEEDBACK_STATUS.Draft]: 'Draft',
  [FEEDBACK_STATUS.New]: 'New',
  [FEEDBACK_STATUS.InReview]: 'In Review',
  [FEEDBACK_STATUS.Accepted]: 'Accepted',
  [FEEDBACK_STATUS.Resolved]: 'Resolved',
  [FEEDBACK_STATUS.OnHold]: 'On Hold',
};

const PRIORITY_LABELS: Record<number, string> = {
  [FEEDBACK_PRIORITY.Critical]: 'Critical',
  [FEEDBACK_PRIORITY.High]: 'High',
  [FEEDBACK_PRIORITY.Medium]: 'Medium',
  [FEEDBACK_PRIORITY.Low]: 'Low',
};

const STATUS_STYLE_MAP: Record<string, string> = {
  Draft: 'draft',
  New: 'draft',
  'In Review': 'in progress',
  Accepted: 'approved',
  Resolved: 'completed',
  'On Hold': 'on hold',
};

const PRIORITY_FILTER_OPTIONS = [
  { value: String(FEEDBACK_PRIORITY.Critical), label: 'Critical' },
  { value: String(FEEDBACK_PRIORITY.High), label: 'High' },
  { value: String(FEEDBACK_PRIORITY.Medium), label: 'Medium' },
  { value: String(FEEDBACK_PRIORITY.Low), label: 'Low' },
  { value: '__unset__', label: 'Unset' },
];

const STATUS_FILTER_OPTIONS = [
  { value: String(FEEDBACK_STATUS.Draft), label: 'Draft' },
  { value: String(FEEDBACK_STATUS.New), label: 'New' },
  { value: String(FEEDBACK_STATUS.InReview), label: 'In Review' },
  { value: String(FEEDBACK_STATUS.Accepted), label: 'Accepted' },
  { value: String(FEEDBACK_STATUS.Resolved), label: 'Resolved' },
  { value: String(FEEDBACK_STATUS.OnHold), label: 'On Hold' },
];

const TYPE_FILTER_OPTIONS = [
  { value: String(FEEDBACK_TYPE.BugReport), label: 'Bug Report' },
  { value: String(FEEDBACK_TYPE.Enhancement), label: 'Enhancement' },
];

const PRIORITY_SELECT_OPTIONS = [
  { value: '__unset__', label: 'Unset' },
  { value: String(FEEDBACK_PRIORITY.Critical), label: 'Critical' },
  { value: String(FEEDBACK_PRIORITY.High), label: 'High' },
  { value: String(FEEDBACK_PRIORITY.Medium), label: 'Medium' },
  { value: String(FEEDBACK_PRIORITY.Low), label: 'Low' },
];

export function UserFeedbackPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const adminRole = useEffectiveAdminRole();
  const isAdmin = (adminRole === 'pmo_admin' || adminRole === 'system_admin');
  const allFt = useEffectiveFeatureToggles();
  const showFeedbackBug = allFt['intakeCard.feedbackBug'] !== false;
  const showFeedbackEnhancement = allFt['intakeCard.feedbackEnhancement'] !== false;
  const [deleteTarget, setDeleteTarget] = useState<UserFeedback | null>(null);
  const [activeCols, setActiveCols] = useState<string[]>([]);
  const feedbackExtraSelect = useViewExtraSelect('userFeedback', activeCols);
  const { data: allFeedback = [], isLoading, error } = useUserFeedback(feedbackExtraSelect);
  // Drafts live ONLY in the submitter's intake queue until they're published
  // (submitted). The admin triage tab must never show anyone's unpublished draft.
  const feedback = useMemo(
    () => allFeedback.filter((f) => (f.pmo_status ?? null) !== FEEDBACK_STATUS.Draft),
    [allFeedback],
  );
  const updateFeedback = useUpdateUserFeedback();
  const savingIds = useFeedbackSavingSet();

  async function handleDelete() {
    if (!deleteTarget) return;
    await deleteUserFeedback(deleteTarget.pmo_userfeedbackid);
    toast.success('Feedback deleted');
    qc.invalidateQueries({ queryKey: ['userFeedback'] });
  }

  async function handlePriorityChange(row: UserFeedback, nextValue: string) {
    try {
      await updateFeedback.mutateAsync({
        id: row.pmo_userfeedbackid,
        payload: { pmo_priority: nextValue === '__unset__' ? undefined : Number(nextValue) },
      });
      toast.success('Priority updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update priority');
    }
  }

  async function handleAssignChange(row: UserFeedback, userId: string) {
    const prev = row['_pmo_assignedto_value'] ?? null;
    try {
      await updateFeedback.mutateAsync({
        id: row.pmo_userfeedbackid,
        // Empty selection clears the assignment (blank), not the owner.
        payload: { 'pmo_AssignedTo@odata.bind': userId ? `/systemusers(${userId})` : null },
      });
      toast.success(userId ? 'Assigned' : 'Assignment cleared');
      // Notify the newly-assigned user (skip self-assign; skip on clear).
      if (userId && userId !== prev) {
        void emitFeedbackAssigned({
          assigneeUserId: userId,
          actorUserId: currentUserId,
          feedbackId: row.pmo_userfeedbackid,
          feedbackTitle: row.pmo_title ?? 'a feedback item',
          kind: row.pmo_feedbacktype === FEEDBACK_TYPE.Enhancement ? 'enhancement' : 'bug',
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update assignment');
    }
  }

  const submitterFilterOptions = useMemo(() => {
    const names = new Set<string>();
    feedback.forEach((r) => {
      const name = r['_createdby_value@OData.Community.Display.V1.FormattedValue'];
      if (name) names.add(name);
    });
    return [...names].sort().map((n) => ({ value: n, label: n }));
  }, [feedback]);

  const assigneeFilterOptions = useMemo(() => {
    const names = new Set<string>();
    feedback.forEach((r) => {
      const name = r['_pmo_assignedto_value@OData.Community.Display.V1.FormattedValue'];
      if (name) names.add(name);
    });
    return [...names].sort().map((n) => ({ value: n, label: n }));
  }, [feedback]);

  const { searchUsers, resolveUserLabel } = useUserSearch();
  const currentUserId = useCurrentUserId();

  const columns: DataTableColumn<UserFeedback>[] = [
    {
      key: 'pmo_feedbacktype',
      header: 'Type',
      filterable: true,
      filterOptions: TYPE_FILTER_OPTIONS,
      getValue: (r) => String(r.pmo_feedbacktype ?? ''),
      render: (r) => {
        const isBug = r.pmo_feedbacktype === FEEDBACK_TYPE.BugReport;
        return (
          <div className="flex items-center gap-1.5">
            {isBug
              ? <Bug className="h-3.5 w-3.5 text-rose-500 shrink-0" />
              : <Lightbulb className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            }
            <span className="text-sm">{TYPE_LABELS[r.pmo_feedbacktype ?? 0] ?? '—'}</span>
          </div>
        );
      },
    },
    {
      key: 'pmo_title',
      header: 'Title',
      sortable: true,
      getValue: (r) => r.pmo_title,
      render: (r) => <TitleCell row={r} />,
    },
    {
      key: 'pmo_description',
      header: 'Description',
      getValue: (r) => r.pmo_description ?? '',
      render: (r) => (
        // Narrow, single-line preview. Full description is on the detail page.
        // Keeps row heights consistent so more items fit above the fold.
        <span
          className="block max-w-[240px] truncate text-sm text-muted-foreground"
          title={r.pmo_description ?? ''}
        >
          {r.pmo_description ?? '—'}
        </span>
      ),
    },
    {
      key: 'pmo_priority',
      header: 'Priority',
      sortable: true,
      filterable: true,
      filterMode: 'multi',
      filterOptions: PRIORITY_FILTER_OPTIONS,
      getValue: (r) => r.pmo_priority == null ? '__unset__' : String(r.pmo_priority),
      render: (r) => (
        isAdmin ? (
          <div onClick={(e) => e.stopPropagation()} className="min-w-[140px]">
            <Select
              value={r.pmo_priority == null ? '__unset__' : String(r.pmo_priority)}
              onValueChange={(v) => void handlePriorityChange(r, v)}
              disabled={updateFeedback.isPending}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Unset" />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_SELECT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">{r.pmo_priority != null ? PRIORITY_LABELS[r.pmo_priority] ?? '—' : 'Unset'}</span>
        )
      ),
    },
    {
      key: '_createdby_value',
      header: 'Submitted By',
      sortable: true,
      filterable: true,
      filterOptions: submitterFilterOptions,
      getValue: (r) => r['_createdby_value@OData.Community.Display.V1.FormattedValue'] ?? '',
      render: (r) => (
        <span className="text-sm text-muted-foreground">
          {r['_createdby_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}
        </span>
      ),
    },
    {
      key: '_pmo_assignedto_value',
      header: 'Assigned To',
      sortable: true,
      filterable: true,
      filterOptions: assigneeFilterOptions,
      getValue: (r) => r['_pmo_assignedto_value@OData.Community.Display.V1.FormattedValue'] ?? '',
      render: (r) => (
        isAdmin ? (
          <div onClick={(e) => e.stopPropagation()} className="min-w-[180px]">
            <SearchableSelect
              value={r['_pmo_assignedto_value'] ?? ''}
              onChange={(v) => void handleAssignChange(r, v)}
              onSearch={searchUsers}
              resolveLabel={resolveUserLabel}
              placeholder="Unassigned"
              disabled={updateFeedback.isPending}
            />
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">
            {r['_pmo_assignedto_value@OData.Community.Display.V1.FormattedValue']
              ?? <span className="italic text-muted-foreground/70">Unassigned</span>}
          </span>
        )
      ),
    },
    {
      key: 'pmo_status',
      header: 'Status',
      filterable: true,
      filterMode: 'multi',
      filterOptions: STATUS_FILTER_OPTIONS,
      getValue: (r) => String(r.pmo_status ?? ''),
      render: (r) => {
        const label = STATUS_LABELS[r.pmo_status ?? 0] ?? '—';
        return <StatusBadge status={STATUS_STYLE_MAP[label] ?? 'inactive'} label={label} />;
      },
    },
    {
      key: 'createdon',
      header: 'Submitted',
      sortable: true,
      getValue: (r) => r.createdon ?? '',
      render: (r) => (
        <span className="text-sm text-muted-foreground">
          {fmtDateOnly(r.createdon)}
        </span>
      ),
    },
    ...(isAdmin ? [{
      key: 'actions',
      header: '',
      getValue: () => '',
      render: (r: UserFeedback) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-rose-600 hover:bg-rose-50 transition-colors"
          title="Delete feedback"
          aria-label="Delete feedback"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ),
    } as DataTableColumn<UserFeedback>] : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Feedback"
        subtitle="Bug reports and enhancement suggestions submitted by users"
        actions={
          (showFeedbackBug || showFeedbackEnhancement) ? (
            <>
              {showFeedbackBug && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/intake/feedback/bug', { state: { from: 'userFeedback' } })}
                >
                  <Bug className="h-3.5 w-3.5 text-rose-500" />
                  Report a Bug
                </Button>
              )}
              {showFeedbackEnhancement && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/intake/feedback/enhancement', { state: { from: 'userFeedback' } })}
                >
                  <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                  Submit Feedback
                </Button>
              )}
            </>
          ) : undefined
        }
      />
      <ErrorBanner error={error as Error | null} />
      <DataTable
        data={feedback}
        columns={columns}
        keyExtractor={(r) => r.pmo_userfeedbackid}
        tableKey="userFeedback"
        onActiveColumnsChange={setActiveCols}
        storageKey="cfr_user_feedback_view"
        defaultSortKey="createdon"
        defaultSortDir="desc"
        forceDefaultSort
        pageSize={50}
        exportFileName="User Feedback"
        searchPlaceholder="Search feedback..."
        searchFn={(r, q) =>
          [r.pmo_title, r.pmo_description, r['_createdby_value@OData.Community.Display.V1.FormattedValue']]
            .some((v) => v?.toLowerCase().includes(q.toLowerCase()))
        }
        onRowClick={(r) => navigate(`/admin/user-feedback/${r.pmo_userfeedbackid}`)}
        rowClassName={(r) => savingIds.has(r.pmo_userfeedbackid) ? 'opacity-60 pointer-events-none' : undefined}
        actionButton={
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MessageSquareText className="h-3.5 w-3.5" />
            {feedback.length} item{feedback.length !== 1 ? 's' : ''}
          </div>
        }
        isLoading={isLoading}
        emptyMessage="No feedback submitted yet."
      />
      <DeleteConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        title="Delete user feedback"
        recordName={deleteTarget?.pmo_title ?? ''}
        extraWarning="Permanently removes the feedback entry from Dataverse."
        onConfirm={handleDelete}
      />
    </div>
  );
}

function TitleCell({ row }: { row: UserFeedback }) {
  const isSaving = useFeedbackSaving(row.pmo_userfeedbackid);
  return (
    <span className={cn('font-medium text-foreground inline-flex items-center gap-1.5')}>
      <span>{row.pmo_title}</span>
      {isSaving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
    </span>
  );
}
