/**
 * HpiGallery — top-level page for /hpi.
 *
 * Grid table (DataTable) of every rcm_payerdeckissue, mirroring the
 * Projects/Programs lists: sortable + resizable + drag-reorder columns,
 * Excel export, and per-user/team custom views (tableKey='hpi'). An
 * Active/Inactive/All state toggle + a "New Issue Number" button sit in the
 * table's action row. Clicking a row opens HpiDetailDrawer (in-page, via the
 * /hpi/:id route) so deep-links and the back button work.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, ShieldAlert, FolderKanban } from 'lucide-react';
import { PageHeader } from '../../../../components/layout/PageHeader';
import { Button } from '../../../../components/ui/button';
import { Badge } from '../../../../components/ui/badge';
import { ErrorBanner } from '../../../../components/common/ErrorBanner';
import { DataTable, type DataTableColumn } from '../../../../components/data-table';
import { HpiCreateDialog } from './HpiCreateDialog';
import { HpiDetailDrawer } from './HpiDetailDrawer';
import { useDeletingProjects } from '../../../../hooks/useDeletingProjects';
import { useHpiIssues, useHpiProjectSummaries } from '../hooks/useHpiIssues';
import { useViewExtraSelect } from '../../../../hooks/useViewExtraSelect';
import { hpiDisplayName, type HpiIssue, type HpiStateFilter } from '../api/hpi.api';
import { useTeamFeatureGate } from '../../_shared/useTeamFeatureGate';
import { PAYER_INITIATIVES_TEAM_ID, hpiDetailHref } from '../constants';
import { fmtDateOnly } from '../../../../lib/dateOnly';

function riskVariant(risk?: string) {
  if (risk === 'External') return 'danger' as const;
  if (risk === 'Shared') return 'warning' as const;
  if (risk === 'Internal') return 'info' as const;
  return 'outline' as const;
}

export function HpiGallery() {
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const allowed = useTeamFeatureGate(PAYER_INITIATIVES_TEAM_ID);
  // Active/Inactive filter -- default 'active' to match the historical view.
  const [stateFilter, setStateFilter] = useState<HpiStateFilter>('active');
  const [activeCols, setActiveCols] = useState<string[]>([]);
  const hpiExtraSelect = useViewExtraSelect('hpi', activeCols);
  const { data: rawIssues = [], isLoading, error } = useHpiIssues(stateFilter, hpiExtraSelect);
  // Optimistic delete: remove an HPI being deleted from the gallery immediately
  // (mirrors ProjectListPage + Payer Inquiries). Shared deletingStore keyed on id.
  const deletingIds = useDeletingProjects();
  const issues = rawIssues.filter((i) => !deletingIds.has(i.rcm_payerdeckissueid));
  const { data: projectSummaries } = useHpiProjectSummaries();
  const [createOpen, setCreateOpen] = useState(false);
  // URL is the single source of truth for which drawer is open — /hpi/:id
  // opens, /hpi closes.
  const detailId = params.id ?? null;

  function openIssue(id: string) { navigate(hpiDetailHref(id), { replace: false }); }
  function closeDrawer() { navigate('/hpi', { replace: false }); }

  // Filter option lists derived from the loaded rows so the column filter
  // dropdowns only surface values that actually exist in the data set.
  const analystOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of issues) {
      const id = i._rcm_analyst_value;
      const label = i['_rcm_analyst_value@OData.Community.Display.V1.FormattedValue'];
      if (id && label && !m.has(id)) m.set(id, label);
    }
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [issues]);

  const riskOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of issues) {
      if (i.rcm_risk == null) continue;
      m.set(String(i.rcm_risk), i['rcm_risk@OData.Community.Display.V1.FormattedValue'] ?? String(i.rcm_risk));
    }
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [issues]);

  const payerOptions = useMemo(() => {
    const s = new Set<string>();
    for (const i of issues) { const p = i.rcm_reservebucketpayer?.trim(); if (p) s.add(p); }
    return [...s].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));
  }, [issues]);

  const arTypeOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of issues) {
      if (i.cr87a_arrecoverytype == null) continue;
      m.set(String(i.cr87a_arrecoverytype), i['cr87a_arrecoverytype@OData.Community.Display.V1.FormattedValue'] ?? String(i.cr87a_arrecoverytype));
    }
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [issues]);

  const columns: DataTableColumn<HpiIssue>[] = useMemo(() => [
    {
      key: 'rcm_issuenumber',
      header: 'Issue #',
      sortable: true,
      defaultWidth: 110,
      getValue: (i) => i.rcm_issuenumber ?? '',
      render: (i) => <span className="font-mono text-xs tabular-nums text-primary font-semibold">{i.rcm_issuenumber || '—'}</span>,
    },
    {
      key: 'rcm_statusdetails',
      header: 'Name',
      sortable: true,
      getValue: (i) => hpiDisplayName(i),
      getExportValue: (i) => hpiDisplayName(i),
      render: (i) => <span className="font-medium text-foreground">{hpiDisplayName(i)}</span>,
    },
    {
      key: '_rcm_analyst_value',
      header: 'Analyst',
      sortable: true,
      filterable: true,
      filterMode: 'multi',
      filterOptions: analystOptions,
      getValue: (i) => i._rcm_analyst_value ?? '',
      getExportValue: (i) => i['_rcm_analyst_value@OData.Community.Display.V1.FormattedValue'] ?? '',
      render: (i) => <span className="text-sm text-muted-foreground">{i['_rcm_analyst_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}</span>,
    },
    {
      key: 'rcm_reservebucketpayer',
      header: 'Payer / Bucket',
      sortable: true,
      filterable: true,
      filterMode: 'multi',
      filterOptions: payerOptions,
      getValue: (i) => i.rcm_reservebucketpayer ?? '',
      render: (i) => <span className="text-sm text-muted-foreground">{i.rcm_reservebucketpayer || '—'}</span>,
    },
    {
      key: 'rcm_risk',
      header: 'Risk',
      filterable: true,
      filterMode: 'multi',
      filterOptions: riskOptions,
      getValue: (i) => String(i.rcm_risk ?? ''),
      render: (i) => {
        const label = i['rcm_risk@OData.Community.Display.V1.FormattedValue'];
        if (!label) return <span className="text-sm text-muted-foreground">—</span>;
        return <Badge variant={riskVariant(label)} className="text-[10px] px-1.5 py-0"><ShieldAlert className="h-2.5 w-2.5 mr-0.5" />{label}</Badge>;
      },
    },
    {
      key: 'cr87a_arrecoverytype',
      header: 'AR Recovery Type',
      filterable: true,
      filterMode: 'multi',
      filterOptions: arTypeOptions,
      getValue: (i) => String(i.cr87a_arrecoverytype ?? ''),
      render: (i) => <span className="text-sm text-muted-foreground">{i['cr87a_arrecoverytype@OData.Community.Display.V1.FormattedValue'] ?? '—'}</span>,
    },
    {
      key: '_relatedProject',
      header: 'Related Project',
      sortable: true,
      getValue: (i) => projectSummaries?.get(i.rcm_payerdeckissueid)?.subject ?? '',
      getExportValue: (i) => {
        const s = projectSummaries?.get(i.rcm_payerdeckissueid);
        return s ? (s.count > 1 ? `${s.subject} (+${s.count - 1})` : s.subject) : '';
      },
      render: (i) => {
        const s = projectSummaries?.get(i.rcm_payerdeckissueid);
        if (!s) return <span className="text-xs italic text-muted-foreground/70">No project</span>;
        return (
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground min-w-0">
            <FolderKanban className="h-3 w-3 shrink-0" />
            <span className="truncate">{s.subject}</span>
            {s.count > 1 && <span className="ml-0.5 text-[10px] text-muted-foreground/70">+{s.count - 1}</span>}
          </span>
        );
      },
    },
    {
      key: 'cr87a_credentialing',
      header: 'Credentialing',
      defaultHidden: true,
      getValue: (i) => (i.cr87a_credentialing ? 'Yes' : 'No'),
      render: (i) => (i.cr87a_credentialing ? <Badge variant="success" className="text-[10px] px-1.5 py-0">Yes</Badge> : <span className="text-sm text-muted-foreground">—</span>),
    },
    {
      key: 'cr87a_pathforward',
      header: 'Path Forward',
      defaultHidden: true,
      getValue: (i) => (i.cr87a_pathforward ? 'Yes' : 'No'),
      render: (i) => (i.cr87a_pathforward ? <Badge variant="info" className="text-[10px] px-1.5 py-0">Yes</Badge> : <span className="text-sm text-muted-foreground">—</span>),
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
  ], [analystOptions, payerOptions, riskOptions, arTypeOptions, projectSummaries]);

  if (!allowed) {
    // Defensive — App.tsx already gates the route; this catches direct navigation.
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-sm font-medium text-foreground">Not available for your team.</p>
        <p className="text-xs text-muted-foreground mt-1">The HPI workspace is owned by the Payer Initiatives team.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="HPI — Health Plan Issues"
        subtitle="Many projects relate to one issue number. Click an issue to see related projects, edit details, or attach more projects."
      />
      <ErrorBanner error={error as Error | null} />

      <DataTable
        data={issues}
        columns={columns}
        keyExtractor={(i) => i.rcm_payerdeckissueid}
        storageKey="cfr_hpi_list_view"
        tableKey="hpi"
        onActiveColumnsChange={setActiveCols}
        exportFileName="HPI Issues"
        defaultSortKey="rcm_issuenumber"
        defaultSortDir="desc"
        pageSize={50}
        searchPlaceholder="Search issue # / name / payer / analyst…"
        searchFn={(i, q) => {
          const hay =
            (i.rcm_issuenumber ?? '') + ' ' +
            (i.rcm_statusdetails ?? '') + ' ' +
            (i.rcm_reservebucketpayer ?? '') + ' ' +
            (i['_rcm_analyst_value@OData.Community.Display.V1.FormattedValue'] ?? '');
          return hay.toLowerCase().includes(q.toLowerCase());
        }}
        onRowClick={(i) => openIssue(i.rcm_payerdeckissueid)}
        isLoading={isLoading}
        emptyMessage="No HPI rows match. Use New Issue Number to create the first HPI."
        actionButton={
          <div className="flex items-center gap-3">
            <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5 text-xs">
              {(['active', 'inactive', 'all'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setStateFilter(mode)}
                  className={
                    'px-3 py-1 rounded transition-colors capitalize ' +
                    (stateFilter === mode ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground')
                  }
                >
                  {mode}
                </button>
              ))}
            </div>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" /> New Issue Number
            </Button>
          </div>
        }
      />

      <HpiCreateDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => openIssue(id)} />
      <HpiDetailDrawer hpiId={detailId} open={!!detailId} onOpenChange={(o) => { if (!o) closeDrawer(); }} />
    </div>
  );
}
