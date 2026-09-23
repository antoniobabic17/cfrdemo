/**
 * PayerIssuesGallery — top-level page for /payer-issues.
 *
 * Grid table (DataTable) of cr87a_payerissue rows, mirroring the
 * Projects/Programs/HPI lists: sortable + resizable + drag-reorder columns,
 * Excel export, and per-user/team custom views (tableKey='payerInquiries').
 * An Active/Inactive/All state toggle + a "New Payer Inquiry" button sit in
 * the table's action row. Rows open PayerIssueDetailDrawer via the
 * /payer-issues/:id route (deep-link + back-button friendly). Payer issues
 * are authored in Nexus - Revenue Cycle Manager; stubs can be created here.
 */
import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { PageHeader } from '../../../../components/layout/PageHeader';
import { Button } from '../../../../components/ui/button';
import { Badge } from '../../../../components/ui/badge';
import { ErrorBanner } from '../../../../components/common/ErrorBanner';
import { DataTable, type DataTableColumn } from '../../../../components/data-table';
import { usePayerIssues } from '../hooks/usePayerIssues';
import type { PayerIssue, PayerIssueStateFilter } from '../api/payerIssues.api';
import { PAYER_ISSUE_STATUS_NEW } from '../api/payerIssues.api';
import { useViewExtraSelect } from '../../../../hooks/useViewExtraSelect';
import { useCurrentUserId } from '../../../../hooks/useCurrentUserId';
import { useCurrentUserTeams } from '../../../../hooks/useCurrentUserTeams';
import { useEffectiveAdminRole } from '../../../../providers/ConfigurationProvider';

import { PayerIssueCreateDialog } from './PayerIssueCreateDialog';
import { PayerIssueDetailDrawer } from './PayerIssueDetailDrawer';
import { useDeletingProjects } from '../../../../hooks/useDeletingProjects';
import { useTeamFeatureGate } from '../../_shared/useTeamFeatureGate';
import { PAYER_INITIATIVES_TEAM_ID, payerIssueDetailHref, PAYER_ISSUES_LIST_PATH } from '../constants';
import { fmtDateOnly } from '../../../../lib/dateOnly';

function statusVariant(status?: string) {
  const s = (status ?? '').toLowerCase();
  if (s.includes('closed') || s.includes('resolved') || s.includes('complete')) return 'success' as const;
  if (s.includes('progress') || s.includes('active') || s.includes('approved')) return 'info' as const;
  if (s.includes('blocked') || s.includes('rejected') || s.includes('escalated') || s.includes('not approved')) return 'danger' as const;
  if (s.includes('pending') || s.includes('hold') || s.includes('review') || s.includes('additional')) return 'warning' as const;
  return 'outline' as const;
}

export function PayerIssuesGallery() {
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const allowed = useTeamFeatureGate(PAYER_INITIATIVES_TEAM_ID);
  // Active/Inactive/All toggle — default 'active' to match the historical view.
  const [stateFilter, setStateFilter] = useState<PayerIssueStateFilter>('active');
  // Columns currently visible in the active view (from DataTable). Drives the
  // dynamic $select so a column added to the view actually fetches its data.
  const [activeCols, setActiveCols] = useState<string[]>([]);
  // Validate active view columns against the table catalog so only REAL
  // Dataverse attributes reach $select (never virtual/custom/formatted keys).
  const extraSelect = useViewExtraSelect('payerInquiries', activeCols);
  const { data: rawIssues = [], isLoading, error } = usePayerIssues(stateFilter, extraSelect);
  // Optimistic delete: a payer inquiry being deleted is removed from the gallery
  // IMMEDIATELY (mirrors ProjectListPage) rather than lingering until refetch.
  // The shared deletingStore is keyed on record id; the drawer marks the id on
  // delete and clears it after invalidation resolves.
  const deletingIds = useDeletingProjects();
  const issues = rawIssues.filter((i) => !deletingIds.has(i.cr87a_payerissueid));
  const [createOpen, setCreateOpen] = useState(false);
  // "Requires action" toggle — mirrors the intake queue's header filter.
  const [approvalOnly, setApprovalOnly] = useState(false);

  // Actionability model:
  //  * A New-status inquiry is ALWAYS yellow-filled (until its status changes),
  //    regardless of who is viewing — see rowClassName below.
  //  * It "requires action" for a given viewer when it's New AND either:
  //      - the viewer IS the assigned analyst, OR
  //      - the analyst is EMPTY and the viewer is a PIT member or an admin.
  //    (An inquiry already assigned to someone else is not the viewer's to-do.)
  const currentUserId = useCurrentUserId();
  const myTeams = useCurrentUserTeams();
  const isAdmin = useEffectiveAdminRole() !== 'none';
  const isPitMember = !!myTeams && Array.from(myTeams).some(
    (id) => id.toLowerCase() === PAYER_INITIATIVES_TEAM_ID.toLowerCase(),
  );
  const bareMe = (currentUserId ?? '').replace(/[{}]/g, '').toLowerCase();

  const isNew = (i: PayerIssue) => i.cr87a_payerissuestatus === PAYER_ISSUE_STATUS_NEW;
  const requiresAction = useCallback((i: PayerIssue): boolean => {
    if (i.cr87a_payerissuestatus !== PAYER_ISSUE_STATUS_NEW) return false;
    const analyst = (i._cr87a_assignedanalyst_value ?? '').replace(/[{}]/g, '').toLowerCase();
    if (analyst) return !!bareMe && analyst === bareMe;   // assigned → only that analyst
    return isPitMember || isAdmin;                         // unassigned → whole team + admins
  }, [bareMe, isPitMember, isAdmin]);
  // URL is the single source of truth for which drawer is open.
  const detailId = params.id ?? null;

  const actionableCount = useMemo(() => issues.filter(requiresAction).length, [issues, requiresAction]);
  const displayData = useMemo(
    () => (approvalOnly ? issues.filter(requiresAction) : issues),
    [issues, approvalOnly, requiresAction],
  );

  function openIssue(id: string) { navigate(payerIssueDetailHref(id), { replace: false }); }
  function closeDrawer() { navigate(PAYER_ISSUES_LIST_PATH, { replace: false }); }

  // Filter option lists derived from the loaded rows.
  const analystOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of issues) {
      const id = i._cr87a_assignedanalyst_value;
      const label = i['_cr87a_assignedanalyst_value@OData.Community.Display.V1.FormattedValue'];
      if (id && label && !m.has(id)) m.set(id, label);
    }
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [issues]);

  const statusOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of issues) {
      if (i.cr87a_payerissuestatus == null) continue;
      m.set(String(i.cr87a_payerissuestatus), i['cr87a_payerissuestatus@OData.Community.Display.V1.FormattedValue'] ?? String(i.cr87a_payerissuestatus));
    }
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [issues]);

  const payerOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of issues) {
      const id = i._cr87a_payer_value;
      const label = i['_cr87a_payer_value@OData.Community.Display.V1.FormattedValue'];
      if (id && label && !m.has(id)) m.set(id, label);
    }
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [issues]);

  const typeOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of issues) {
      if (i.cr87a_payerissuetype == null) continue;
      m.set(String(i.cr87a_payerissuetype), i['cr87a_payerissuetype@OData.Community.Display.V1.FormattedValue'] ?? String(i.cr87a_payerissuetype));
    }
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [issues]);

  const columns: DataTableColumn<PayerIssue>[] = useMemo(() => [
    {
      key: 'cr87a_payerissueidauto',
      header: 'ID',
      sortable: true,
      defaultWidth: 120,
      getValue: (i) => i.cr87a_payerissueidauto ?? '',
      render: (i) => <span className="font-mono text-xs tabular-nums text-primary font-semibold">{i.cr87a_payerissueidauto || '—'}</span>,
    },
    {
      key: 'cr87a_name',
      header: 'Name',
      sortable: true,
      getValue: (i) => i.cr87a_name ?? '',
      render: (i) => <span className="font-medium text-foreground">{i.cr87a_name || '(unnamed)'}</span>,
    },
    {
      key: '_cr87a_payer_value',
      header: 'Payer',
      sortable: true,
      filterable: true,
      filterMode: 'multi',
      filterOptions: payerOptions,
      getValue: (i) => i._cr87a_payer_value ?? '',
      getExportValue: (i) => i['_cr87a_payer_value@OData.Community.Display.V1.FormattedValue'] ?? '',
      render: (i) => <span className="text-sm text-muted-foreground">{i['_cr87a_payer_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}</span>,
    },
    {
      key: 'cr87a_payerissuestatus',
      header: 'Status',
      filterable: true,
      filterMode: 'multi',
      filterOptions: statusOptions,
      getValue: (i) => String(i.cr87a_payerissuestatus ?? ''),
      render: (i) => {
        const label = i['cr87a_payerissuestatus@OData.Community.Display.V1.FormattedValue'];
        if (!label) return <span className="text-sm text-muted-foreground">—</span>;
        return <Badge variant={statusVariant(label)} className="text-[10px] px-1.5 py-0">{label}</Badge>;
      },
    },
    {
      key: 'cr87a_payerissuetype',
      header: 'Type',
      filterable: true,
      filterMode: 'multi',
      filterOptions: typeOptions,
      getValue: (i) => String(i.cr87a_payerissuetype ?? ''),
      render: (i) => <span className="text-sm text-muted-foreground">{i['cr87a_payerissuetype@OData.Community.Display.V1.FormattedValue'] ?? '—'}</span>,
    },
    {
      key: '_pmo_payerinitiatives_project_value',
      header: 'Project',
      sortable: true,
      defaultHidden: true,
      getValue: (i) => i['_pmo_payerinitiatives_project_value@OData.Community.Display.V1.FormattedValue'] ?? i['_pmo_payerinitiatives_msdynproject_value@OData.Community.Display.V1.FormattedValue'] ?? '',
      getExportValue: (i) => i['_pmo_payerinitiatives_project_value@OData.Community.Display.V1.FormattedValue'] ?? i['_pmo_payerinitiatives_msdynproject_value@OData.Community.Display.V1.FormattedValue'] ?? '',
      render: (i) => {
        const label = i['_pmo_payerinitiatives_project_value@OData.Community.Display.V1.FormattedValue'] ?? i['_pmo_payerinitiatives_msdynproject_value@OData.Community.Display.V1.FormattedValue'];
        return <span className="text-sm text-muted-foreground">{label ?? '—'}</span>;
      },
    },
    {
      key: 'cr87a_shortdescription',
      header: 'Short Description',
      defaultHidden: true,
      getValue: (i) => i.cr87a_shortdescription ?? '',
      render: (i) => <span className="text-sm text-muted-foreground truncate max-w-sm block">{i.cr87a_shortdescription || '—'}</span>,
    },
    {
      key: '_createdby_value',
      header: 'Created By',
      sortable: true,
      defaultHidden: true,
      getValue: (i) => i['_createdby_value@OData.Community.Display.V1.FormattedValue'] ?? '',
      render: (i) => <span className="text-sm text-muted-foreground">{i['_createdby_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}</span>,
    },
    {
      key: 'rcm_accepteddate',
      header: 'Accepted Date',
      sortable: true,
      defaultHidden: true,
      getValue: (i) => i.rcm_accepteddate ?? '',
      render: (i) => <span className="text-sm text-muted-foreground">{i.rcm_accepteddate ? fmtDateOnly(i.rcm_accepteddate) : '—'}</span>,
    },
    {
      key: 'cr87a_response',
      header: 'Response',
      defaultHidden: true,
      getValue: (i) => i.cr87a_response ?? '',
      render: (i) => <span className="text-sm text-muted-foreground truncate max-w-sm block">{i.cr87a_response || '—'}</span>,
    },
    {
      key: 'createdon',
      header: 'Created On',
      sortable: true,
      defaultHidden: true,
      getValue: (i) => i.createdon ?? '',
      render: (i) => <span className="text-sm text-muted-foreground">{i.createdon ? fmtDateOnly(i.createdon) : '—'}</span>,
    },
    {
      key: 'modifiedon',
      header: 'Modified On',
      sortable: true,
      defaultHidden: true,
      getValue: (i) => i.modifiedon ?? '',
      render: (i) => <span className="text-sm text-muted-foreground">{i.modifiedon ? fmtDateOnly(i.modifiedon) : '—'}</span>,
    },
    {
      key: '_cr87a_assignedanalyst_value',
      header: 'Analyst',
      sortable: true,
      filterable: true,
      filterMode: 'multi',
      filterOptions: analystOptions,
      getValue: (i) => i._cr87a_assignedanalyst_value ?? '',
      getExportValue: (i) => i['_cr87a_assignedanalyst_value@OData.Community.Display.V1.FormattedValue'] ?? '',
      render: (i) => <span className="text-sm text-muted-foreground">{i['_cr87a_assignedanalyst_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}</span>,
    },
  ], [analystOptions, payerOptions, statusOptions, typeOptions]);

  if (!allowed) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-sm font-medium text-foreground">Not available for your team.</p>
        <p className="text-xs text-muted-foreground mt-1">The Payer Inquiries workspace is owned by the Payer Initiatives team.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payer Inquiries"
        subtitle="Active payer inquiries from the Nexus Revenue Cycle Manager catalog. Stubs can be created here; full enrichment lives in the source system."
      />
      <ErrorBanner error={error as Error | null} />

      <DataTable
        data={displayData}
        columns={columns}
        keyExtractor={(i) => i.cr87a_payerissueid}
        rowClassName={(i) => (isNew(i) ? 'bg-amber-50 dark:bg-amber-950/20' : undefined)}
        storageKey="cfr_payer_inquiries_list_view"
        tableKey="payerInquiries"
        exportFileName="Payer Inquiries"
        defaultSortKey="createdon"
        defaultSortDir="desc"
        pageSize={50}
        searchPlaceholder="Search name / ID / payer / analyst / description…"
        searchFn={(i, q) => {
          const hay =
            (i.cr87a_name ?? '') + ' ' +
            (i.cr87a_payerissueidauto ?? '') + ' ' +
            (i['_cr87a_payer_value@OData.Community.Display.V1.FormattedValue'] ?? '') + ' ' +
            (i['_cr87a_assignedanalyst_value@OData.Community.Display.V1.FormattedValue'] ?? '') + ' ' +
            (i.cr87a_shortdescription ?? '');
          return hay.toLowerCase().includes(q.toLowerCase());
        }}
        onActiveColumnsChange={setActiveCols}
        onRowClick={(i) => openIssue(i.cr87a_payerissueid)}
        isLoading={isLoading}
        emptyMessage="No payer inquiries match. Use New Payer Inquiry to create a stub."
        actionButton={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={approvalOnly}
                onChange={(e) => setApprovalOnly(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-amber-500"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                Requires action
                {actionableCount > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-amber-500 text-[10px] font-bold text-white leading-none">
                    {actionableCount}
                  </span>
                )}
              </span>
            </label>
            <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5 text-xs">
              {(['active', 'inactive', 'all'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setStateFilter(mode)}
                  className={'px-3 py-1 rounded transition-colors capitalize ' + (stateFilter === mode ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground')}
                >
                  {mode}
                </button>
              ))}
            </div>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" /> New Payer Inquiry
            </Button>
          </div>
        }
      />

      <PayerIssueCreateDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => openIssue(id)} />
      <PayerIssueDetailDrawer payerIssueId={detailId} open={!!detailId} onOpenChange={(o) => { if (!o) closeDrawer(); }} />
    </div>
  );
}
