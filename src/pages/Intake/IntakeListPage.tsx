import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Inbox, Trash2, Check, CheckCheck } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { DataTable, type DataTableColumn } from '../../components/data-table';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { Button } from '../../components/ui/button';
import { DeleteConfirmDialog } from '../../components/common/DeleteConfirmDialog';
import { useActionItems } from '../../hooks/useActionItems';
import { useCurrentUserId } from '../../hooks/useCurrentUserId';
import { useEffectiveAdminRole } from '../../providers/ConfigurationProvider';
import { deleteProjectRequest } from '../../api/projectRequests.api';
import { deleteUserFeedback } from '../../api/userFeedback.api';
import { markAsRead, deleteNotification } from '../../api/notifications.api';
import { useChangeAudit } from '../../hooks/useChangeAudit';
import type { ProjectRequest } from '../../models/projectRequest.model';
import type { UserFeedback } from '../../models/userFeedback.model';
import type { Notification } from '../../models/notification.model';
import type { ActionItem } from '../../lib/actionItems';
import { isInformationalNotification } from '../../lib/actionItems';
import { NotificationDetailDialog } from '../../components/common/NotificationDetailDialog';
import { REQUEST_STATUS, REQUEST_TYPE, FEEDBACK_STATUS, FEEDBACK_TYPE, FEEDBACK_PRIORITY, NOTIF_CATEGORY } from '../../lib/constants';
import { toast } from '../../hooks/useToast';
import { fmtDateOnly } from '../../lib/dateOnly';

const REQUEST_TYPE_LABELS: Record<number, string> = {
  893460000: 'New Project',
  893460001: 'Change Request',
  893460002: 'Enhancement',
  893460003: 'Support',
  893460004: 'New Program',
};

const PRIORITY_LABELS: Record<number, string> = {
  893460010: 'Critical',
  893460011: 'High',
  893460012: 'Medium',
  893460013: 'Low',
};

const FEEDBACK_TYPE_LABELS: Record<number, string> = {
  [FEEDBACK_TYPE.BugReport]: 'Bug Report',
  [FEEDBACK_TYPE.Enhancement]: 'Enhancement',
};

const FEEDBACK_PRIORITY_LABELS: Record<number, string> = {
  [FEEDBACK_PRIORITY.Critical]: 'Critical',
  [FEEDBACK_PRIORITY.High]: 'High',
  [FEEDBACK_PRIORITY.Medium]: 'Medium',
  [FEEDBACK_PRIORITY.Low]: 'Low',
};

const FEEDBACK_STATUS_LABELS: Record<number, string> = {
  [FEEDBACK_STATUS.Draft]: 'Draft',
  [FEEDBACK_STATUS.New]: 'New',
  [FEEDBACK_STATUS.InReview]: 'In Review',
  [FEEDBACK_STATUS.Accepted]: 'Accepted',
  [FEEDBACK_STATUS.Resolved]: 'Resolved',
};

/**
 * The queue renders a unified list produced by useActionItems / selectActionItems.
 * Three Dataverse sources are normalized to ActionItem: project/program requests,
 * user feedback, and per-user notifications (task assigned, clarification asked,
 * request decided). This QueueRow is a thin presentation adapter over ActionItem
 * that resolves the source-specific labels the DataTable columns show.
 *
 * SCOPING: non-admins see their team's requests + their own drafts + notifications
 * targeted at them (team+mine). Admins see everything. Converted requests are held
 * in a separate bucket and only appended when "Show converted" is on.
 *
 * COUNT: the "Requires action" pill reads actionableCount straight from the
 * selector — the SAME number the sidebar bubble uses, so they can't drift.
 */
interface QueueRow {
  item: ActionItem;
  ref: string;
  /** Informative "Kind: context" label shown in the leading Item column
   *  (e.g. "Project: Draft", "Program: Beta", "Task: Do X"). */
  quickTitle: string;
  title: string;
  submittedBy: string;
  typeLabel: string;
  priorityLabel: string;
  statusValue: number | null;
  statusLabel: string;
  teamLabel: string;
}

function toQueueRow(item: ActionItem): QueueRow {
  if (item.source === 'request') {
    const r = item.raw as ProjectRequest;
    // A row in the queue is a REQUEST until the assigned team converts it into a
    // real project/program — so label it "Request" (or "Program Request"), never
    // "Project", to keep the two phases distinct.
    const requestKind = r.pmo_requesttype === REQUEST_TYPE.NewProgram ? 'Program Request' : 'Request';
    const requestStatus = r['pmo_status@OData.Community.Display.V1.FormattedValue'] ?? '—';
    return {
      item,
      ref: r.pmo_autonumber ?? '—',
      quickTitle: `${requestKind}: ${requestStatus}`,
      title: r.pmo_name ?? 'Untitled Request',
      submittedBy:
        r['_pmo_requestedby_value@OData.Community.Display.V1.FormattedValue'] ??
        r['_createdby_value@OData.Community.Display.V1.FormattedValue'] ?? '—',
      typeLabel: r.pmo_requesttype != null ? REQUEST_TYPE_LABELS[r.pmo_requesttype] ?? '—' : '—',
      priorityLabel: r.pmo_priority != null ? PRIORITY_LABELS[r.pmo_priority] ?? '—' : '—',
      statusValue: r.pmo_status ?? null,
      statusLabel: r['pmo_status@OData.Community.Display.V1.FormattedValue'] ?? '—',
      teamLabel: r['_pmo_targetteam_value@OData.Community.Display.V1.FormattedValue'] ?? '—',
    };
  }
  if (item.source === 'feedback') {
    const f = item.raw as UserFeedback;
    const status = f.pmo_status ?? null;
    const feedbackType = f.pmo_feedbacktype != null ? FEEDBACK_TYPE_LABELS[f.pmo_feedbacktype] ?? 'Feedback' : 'Feedback';
    return {
      item,
      ref: `FB-${f.pmo_userfeedbackid.slice(0, 6).toUpperCase()}`,
      quickTitle: `Feedback: ${feedbackType}`,
      title: f.pmo_title ?? 'Untitled',
      submittedBy: f['_createdby_value@OData.Community.Display.V1.FormattedValue'] ?? '—',
      typeLabel: f.pmo_feedbacktype != null ? FEEDBACK_TYPE_LABELS[f.pmo_feedbacktype] ?? 'Feedback' : 'Feedback',
      priorityLabel: f.pmo_priority != null ? FEEDBACK_PRIORITY_LABELS[f.pmo_priority] ?? '—' : '—',
      statusValue: status,
      statusLabel:
        (status != null ? FEEDBACK_STATUS_LABELS[status] : undefined) ??
        f['pmo_status@OData.Community.Display.V1.FormattedValue'] ?? '—',
      teamLabel: '—',
    };
  }
  // notification
  const n = item.raw as Notification;
  return {
    item,
    ref: 'NTF',
    // The description (title) already carries the role + Project/Program: name
    // context, so the Item column just labels the row type.
    quickTitle: 'Notification',
    title: n.pmo_title ?? 'Notification',
    // The notification's creator IS the actor who assigned the task/role
    // (app-emitted notifications are created as the assigning user).
    submittedBy: n['_createdby_value@OData.Community.Display.V1.FormattedValue'] ?? '—',
    typeLabel: 'Notification',
    priorityLabel: '—',
    statusValue: null,
    statusLabel: 'Notification',
    teamLabel: '—',
  };
}

export function IntakeListPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const auditChange = useChangeAudit();
  const { items, converted, actionableCount, isLoading, error } = useActionItems();
  const [approvalOnly, setApprovalOnly] = useState(false);
  const [showConverted, setShowConverted] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<QueueRow | null>(null);
  const [detailNotif, setDetailNotif] = useState<Notification | null>(null);
  const currentUserId = useCurrentUserId();
  const isAdmin = useEffectiveAdminRole() !== 'none';

  // Base set = in-scope, non-converted items. "Show converted" appends the
  // converted bucket (collapsed by default). Both are already newest-first.
  const rows: QueueRow[] = useMemo(() => {
    const source = showConverted ? [...items, ...converted] : items;
    return source.map(toQueueRow);
  }, [items, converted, showConverted]);

  // Delete stays author-owned and early-stage only, and only applies to
  // request/feedback rows — notifications are dismissed, not deleted, here.
  function canDelete(row: QueueRow): boolean {
    if (!currentUserId) return false;
    // Admins can hard-delete any notification row (e.g. an old "Request Rejected"
    // alert). Non-admins never delete notifications — they acknowledge/clear them.
    if (row.item.source === 'notification') return isAdmin;
    // Feedback drafts stay author-deletable (a draft bug/enhancement lives only
    // in the author's queue until submitted).
    if (row.item.source === 'feedback') {
      const createdBy = (row.item.raw as { '_createdby_value'?: string })['_createdby_value'];
      if (!createdBy || createdBy.replace(/[{}]/g, '').toLowerCase() !== currentUserId.toLowerCase()) return false;
      return row.statusValue === FEEDBACK_STATUS.Draft;
    }
    // Requests: the REQUESTER can never delete (they Cancel instead — status →
    // Cancelled + reason, keeps history, even for a Draft). Only ADMINS may
    // delete a request outright.
    return isAdmin;
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const deletedName = deleteTarget.title;
    const deletedId = deleteTarget.item.id;
    if (deleteTarget.item.source === 'notification') {
      // Admin-only hard delete of a notification row (canDelete gates to admin).
      await deleteNotification(deletedId);
      toast.success('Notification deleted');
      qc.invalidateQueries({ queryKey: ['notifications'] });
      return;
    }
    if (deleteTarget.item.source === 'feedback') {
      // Only draft feedback/bug reports are deletable here (canDelete already
      // gates to Draft + author). A draft lives ONLY in the intake queue until
      // it is submitted, so the author can discard it before it's published.
      await deleteUserFeedback(deletedId);
      toast.success('Draft deleted');
      qc.invalidateQueries({ queryKey: ['userFeedback'] });
      return;
    }
    await deleteProjectRequest(deletedId);
    auditChange({
      entityType: 'intake',
      entityId: deletedId,
      entityName: deletedName,
      action: 'delete',
    });
    toast.success('Request deleted');
    qc.invalidateQueries({ queryKey: ['projectRequests'] });
  }

  // Flip the pmo_isread flag on cached notification rows immediately so the UI
  // reacts instantly (no wait for the Dataverse round-trip / poll refetch).
  // The query key is ['notifications', userId]; a predicate keeps us decoupled
  // from the exact userId suffix.
  function optimisticallyMarkRead(ids: Set<string>) {
    qc.setQueriesData<Notification[]>({ queryKey: ['notifications'] }, (old) =>
      old?.map((n) => (ids.has(n.pmo_notificationid) ? { ...n, pmo_isread: true } : n)),
    );
  }

  // Acknowledge a single notification (mark read) WITHOUT navigating. Only
  // notifications carry a real read/unread flag — requests/feedback stay
  // click-through to triage, so the checkmark is notification-only. Optimistic:
  // update the cache first for an instant UI, then persist behind it.
  // A "new request for your team" notification is NOT clearable — the assigned
  // team must Approve or Reject; like a draft it persists until decided. Never
  // eligible for acknowledge (single or "clear all") and shows no check.
  function isLockedRequestNotification(row: QueueRow): boolean {
    return row.item.source === 'notification'
      && row.item.notifCategory === NOTIF_CATEGORY.RequestSubmitted;
  }

  function handleAcknowledge(row: QueueRow) {
    if (row.item.source !== 'notification' || row.item.isRead) return;
    if (isLockedRequestNotification(row)) return;
    optimisticallyMarkRead(new Set([row.item.id]));
    void markAsRead(row.item.id)
      .then(() => qc.invalidateQueries({ queryKey: ['notifications'] }))
      .catch(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
  }

  // "Check all": mark every unread notification currently in scope as read.
  const unreadNotifications = useMemo(
    () => rows.filter((r) => r.item.source === 'notification' && !r.item.isRead && !isLockedRequestNotification(r)),
    [rows],
  );
  function handleAcknowledgeAll() {
    if (unreadNotifications.length === 0) return;
    const ids = unreadNotifications.map((r) => r.item.id);
    optimisticallyMarkRead(new Set(ids));
    const count = ids.length;
    void Promise.all(ids.map((id) => markAsRead(id)))
      .then(() => qc.invalidateQueries({ queryKey: ['notifications'] }))
      .catch(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
    toast.success(`Acknowledged ${count} notification${count !== 1 ? 's' : ''}`);
  }

  const needsAction = (row: QueueRow) => row.item.isActionable;

  const displayData = useMemo(
    () => approvalOnly ? rows.filter(needsAction) : rows,
    [rows, approvalOnly],
  );

  const columns: DataTableColumn<QueueRow>[] = [
    {
      key: 'ref',
      header: 'Item',
      sortable: true,
      className: 'w-[140px]',
      // Multi-select filter on the virtual Item/Type value (Request /
      // Program Request / Feedback: … / Notification), auto-derived from data.
      filterable: true,
      filterMode: 'multi',
      getValue: (r) => r.quickTitle,
      render: (r) => (
        <span className="font-medium text-foreground truncate">{r.quickTitle}</span>
      ),
    },
    {
      key: 'title',
      header: 'Description',
      sortable: true,
      className: 'max-w-[360px]',
      getValue: (r) => r.title,
      render: (r) => (
        <span className="block truncate font-medium text-foreground" title={r.title}>{r.title}</span>
      ),
    },
    {
      key: 'submittedBy',
      header: 'Submitted By',
      sortable: true,
      className: 'whitespace-nowrap',
      getValue: (r) => r.submittedBy,
      render: (r) => <span className="text-sm text-muted-foreground">{r.submittedBy}</span>,
    },
    // The following columns are hidden in the Default view but selectable in
    // custom views (defaultHidden), so a user can build a richer Intake view.
    {
      key: 'typeLabel',
      header: 'Type',
      sortable: true,
      defaultHidden: true,
      getValue: (r) => r.typeLabel,
      render: (r) => <span className="text-sm text-muted-foreground">{r.typeLabel}</span>,
    },
    {
      key: 'statusLabel',
      header: 'Status',
      sortable: true,
      defaultHidden: true,
      getValue: (r) => r.statusLabel,
      render: (r) => <span className="text-sm text-muted-foreground">{r.statusLabel}</span>,
    },
    {
      key: 'priorityLabel',
      header: 'Priority',
      sortable: true,
      defaultHidden: true,
      getValue: (r) => r.priorityLabel,
      render: (r) => <span className="text-sm text-muted-foreground">{r.priorityLabel}</span>,
    },
    {
      key: 'teamLabel',
      header: 'Team',
      sortable: true,
      defaultHidden: true,
      getValue: (r) => r.teamLabel,
      render: (r) => <span className="text-sm text-muted-foreground">{r.teamLabel}</span>,
    },
    {
      key: 'createdon',
      header: 'Submitted',
      sortable: true,
      defaultHidden: true,
      getValue: (r) => r.item.createdon ?? '',
      render: (r) => <span className="text-sm text-muted-foreground">{fmtDateOnly(r.item.createdon)}</span>,
    },
    {
      key: 'actions',
      header: '',
      // Pinned action column (acknowledge ✓ / delete): fixed width, not resizable.
      className: 'w-20',
      resizable: false,
      getValue: () => '',
      render: (r) => {
        // Unread notifications get an acknowledge checkmark that marks them
        // read in place (no navigation). Deletable requests get the trash can.
        const showAck = r.item.source === 'notification' && !r.item.isRead && !isLockedRequestNotification(r);
        return (
          <div className="flex items-center justify-end gap-1">
            {showAck && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleAcknowledge(r); }}
                className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                title="Acknowledge — mark as read"
                aria-label="Acknowledge notification"
              >
                <Check className="h-4 w-4" />
              </button>
            )}
            {canDelete(r) && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }}
                className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-rose-600 hover:bg-rose-50 transition-colors"
                title={r.item.source === 'notification' ? 'Delete notification' : 'Delete request'}
                aria-label={r.item.source === 'notification' ? 'Delete notification' : 'Delete request'}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Intake Queue"
        subtitle="Requests, application feedback, and your notifications"
        actions={
          <Button size="sm" onClick={() => navigate('/intake/new')}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Request
          </Button>
        }
      />
      <ErrorBanner error={error} />
      <DataTable
        data={displayData}
        columns={columns}
        keyExtractor={(r) => `${r.item.source}:${r.item.id}`}
        tableKey="intake"
        exportFileName="Intake Queue"
        searchPlaceholder="Search requests, feedback, notifications..."
        searchFn={(r, q) =>
          [r.quickTitle, r.title, r.ref, r.teamLabel, r.submittedBy, r.typeLabel]
            .some((v) => v?.toLowerCase().includes(q.toLowerCase()))
        }
        rowClassName={(r) => {
          // Rejected (team declined) and Cancelled (requester withdrew) requests
          // both get a light red fill so the ask reads as "closed, not acted on"
          // at a glance (distinct from the actionable highlight).
          if (r.item.source === 'request' &&
              (r.statusValue === REQUEST_STATUS.Rejected || r.statusValue === REQUEST_STATUS.Cancelled))
            return 'bg-rose-50 dark:bg-rose-950/20';
          // Decision notifications (request Cancelled by requester / Rejected by
          // team) read as closed/bad-news — red, not the amber unread highlight.
          if (r.item.source === 'notification' && r.item.notifCategory === NOTIF_CATEGORY.RequestDecision)
            return 'bg-rose-50 dark:bg-rose-950/20';
          return needsAction(r) ? 'bg-rose-100/50 dark:bg-rose-950/25' : undefined;
        }}
        onRowClick={(r) => {
          // Informational notifications (feedback resolved / on-hold decisions to
          // the submitter) have nowhere useful to navigate — their content lives
          // in the body. Open a read-only detail dialog instead of a dead /intake
          // navigate. Mark read the same deferred way as a normal row click.
          const isInfo = r.item.source === 'notification' && isInformationalNotification(r.item);
          if (isInfo) {
            setDetailNotif(r.item.raw as Notification);
          } else {
            // Navigate FIRST so the destination (and its loading spinner) shows
            // immediately. The mark-read cache mutation re-renders this heavy queue
            // table, so DEFER it to after the route transition commits — otherwise
            // that synchronous re-render stalls the spinner from appearing.
            // Every row carries { from: 'intake' } so the destination's Back
            // button returns to the queue — notifications (task/role/feedback),
            // request detail, feedback drafts, and the admin feedback detail.
            navigate(r.item.actionUrl, { state: { from: 'intake' } });
          }
          if (r.item.source === 'notification' && !r.item.isRead && !isLockedRequestNotification(r)) {
            const nid = r.item.id;
            setTimeout(() => {
              optimisticallyMarkRead(new Set([nid]));
              void markAsRead(nid)
                .then(() => qc.invalidateQueries({ queryKey: ['notifications'] }))
                .catch(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
            }, 0);
          }
        }}
        actionButton={
          <div className="flex items-center gap-4">
            {unreadNotifications.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleAcknowledgeAll()}
                className="h-7"
                title="Mark all your unread notifications as read"
              >
                <CheckCheck className="h-3.5 w-3.5 mr-1.5" />
                Clear all notifications ({unreadNotifications.length})
              </Button>
            )}
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={approvalOnly}
                onChange={(e) => setApprovalOnly(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-rose-500"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                Requires action
                {actionableCount > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-rose-500 text-[10px] font-bold text-white leading-none">
                    {actionableCount}
                  </span>
                )}
              </span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showConverted}
                onChange={(e) => setShowConverted(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-emerald-500"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                Show converted
                {converted.length > 0 && (
                  <span className="ml-1 text-muted-foreground/70">({converted.length})</span>
                )}
              </span>
            </label>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Inbox className="h-3.5 w-3.5" />
              {displayData.length} item{displayData.length !== 1 ? 's' : ''}
            </div>
          </div>
        }
        isLoading={isLoading}
        emptyMessage={approvalOnly ? 'Nothing requires your action right now.' : 'Your intake queue is empty.'}
      />
      <DeleteConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        title={deleteTarget?.item.source === 'notification' ? 'Delete notification' : 'Delete request'}
        recordName={deleteTarget?.title ?? ''}
        extraWarning={deleteTarget?.item.source === 'notification'
          ? 'This permanently deletes the notification. This action cannot be undone.'
          : 'Only draft requests can be deleted, and only by the user who created them. Submitted requests must be withdrawn with Cancel instead. This action is permanent.'}
        onConfirm={handleDelete}
      />
      <NotificationDetailDialog
        open={detailNotif !== null}
        notification={detailNotif}
        onClose={() => setDetailNotif(null)}
      />
    </div>
  );
}
