import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Network, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { PageHeader } from '../../components/layout/PageHeader';
import { DataTable, type DataTableColumn } from '../../components/data-table';
import { HealthBadge } from '../../components/common/HealthBadge';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { LoadingOverlay } from '../../components/common/LoadingOverlay';
import { Button } from '../../components/ui/button';
import { usePrograms } from '../../hooks/usePrograms';
import { useViewExtraSelect } from '../../hooks/useViewExtraSelect';
import { useDataSource } from '../../lib/taskSource';
import { useDeletingPrograms } from '../../hooks/useDeletingPrograms';
import { useActiveProjects } from '../../hooks/useProjects';
import type { Program } from '../../models/program.model';
import { OVERALL_HEALTH, ACCEL_STATE } from '../../lib/constants';
import { fmtDateOnly } from '../../lib/dateOnly';

const currencyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
});

const HEALTH_FILTER_OPTIONS = [
  { value: String(OVERALL_HEALTH.OnTrack), label: 'On Track' },
  { value: String(OVERALL_HEALTH.AtRisk), label: 'At Risk' },
  { value: String(OVERALL_HEALTH.OffTrack), label: 'Off Track' },
];

const STATE_FILTER_OPTIONS = [
  { value: String(ACCEL_STATE.Proposed), label: 'Proposed' },
  { value: String(ACCEL_STATE.Active),   label: 'Active' },
  { value: String(ACCEL_STATE.Closed),   label: 'Closed' },
  { value: String(ACCEL_STATE.OnHold),   label: 'On Hold' },
];

function StateBadge({ state, formatted }: { state?: number; formatted?: string }) {
  if (state == null && !formatted) return <span className="text-sm text-muted-foreground">—</span>;
  const label = formatted ?? 'Unknown';
  const style =
    state === ACCEL_STATE.Active   ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20' :
    state === ACCEL_STATE.OnHold   ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-amber-500/20' :
    state === ACCEL_STATE.Closed   ? 'bg-muted/60 text-muted-foreground ring-border' :
    'bg-primary/10 text-primary ring-primary/20';
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1', style)}>
      {label}
    </span>
  );
}

interface EnrichedProgram extends Program {
  _projectCount: number;
  _atRiskCount: number;
}

export function ProgramListPage() {
  const navigate = useNavigate();
  // First-open feedback: ProgramDetailPage is a lazy() chunk, so the first
  // navigation suspends while it loads and the list appears to linger. Show
  // the same 'Loading project...' overlay the detail page uses, synchronously
  // on click, so the click registers instantly. Mirrors ProjectListPage.
  const [navigating, setNavigating] = useState(false);
  const dataSource = useDataSource();
  const [activeCols, setActiveCols] = useState<string[]>([]);
  const programExtraSelect = useViewExtraSelect('programs', activeCols, dataSource);
  const { data: programs = [], isLoading: loadingPrograms, error: progError } = usePrograms(programExtraSelect);
  const deletingIds = useDeletingPrograms();
  // Optimistic delete: a program being cascade-deleted vanishes from the list
  // immediately (its cascade + child-project deletes run in the background).
  const visiblePrograms = programs.filter((pr) => !deletingIds.has(pr.msdyn_projectprogramid));
  const { data: projects = [], isLoading: loadingProjects, error: projError } = useActiveProjects();
  const isLoading = loadingPrograms || loadingProjects;
  const error = progError || projError;

  // Enrich programs with project counts computed client-side
  const enriched: EnrichedProgram[] = visiblePrograms.map((prog) => {
    const linked = projects.filter((p) => p._msdyn_program_value === prog.msdyn_projectprogramid);
    const atRisk = linked.filter(
      (p) => p.proj_overallhealth === OVERALL_HEALTH.AtRisk || p.proj_overallhealth === OVERALL_HEALTH.OffTrack
    ).length;
    return { ...prog, _projectCount: linked.length, _atRiskCount: atRisk };
  });

  const columns: DataTableColumn<EnrichedProgram>[] = [
    {
      key: 'pmo_programid',
      header: 'Program ID',
      sortable: true,
      getValue: (p) => p.pmo_programid ?? '',
      render: (p) =>
        p.pmo_programid ? (
          <span className="font-mono text-xs tabular-nums text-foreground">{p.pmo_programid}</span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      key: 'msdyn_name',
      header: 'Program',
      sortable: true,
      getValue: (p) => p.msdyn_name,
      render: (p) => (
        <div className="min-w-0">
          <span className="font-medium text-foreground">{p.msdyn_name}</span>
          {p.msdyn_description && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-sm">{p.msdyn_description}</p>
          )}
        </div>
      ),
    },
    {
      key: 'proj_overallhealth',
      header: 'Health',
      filterable: true,
      filterOptions: HEALTH_FILTER_OPTIONS,
      getValue: (p) => String(p.proj_overallhealth ?? ''),
      render: (p) => <HealthBadge value={p.proj_overallhealth} />,
    },
    {
      key: 'proj_state',
      header: 'State',
      filterable: true,
      filterOptions: STATE_FILTER_OPTIONS,
      getValue: (p) => String(p.proj_state ?? ''),
      render: (p) => (
        <StateBadge
          state={p.proj_state}
          formatted={p['proj_state@OData.Community.Display.V1.FormattedValue']}
        />
      ),
    },
    {
      key: '_proj_manager_value',
      header: 'Program Manager',
      sortable: true,
      getValue: (p) => p['_proj_manager_value@OData.Community.Display.V1.FormattedValue'] ?? '',
      render: (p) => (
        <span className="text-sm text-muted-foreground">
          {p['_proj_manager_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}
        </span>
      ),
    },
    {
      key: '_projectCount',
      header: 'Projects',
      sortable: true,
      getValue: (p) => p._projectCount,
      render: (p) => (
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground tabular-nums">{p._projectCount}</span>
          {p._atRiskCount > 0 && (
            <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
              {p._atRiskCount} at risk
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'msdyn_budget',
      header: 'Budget',
      sortable: true,
      getValue: (p) => p.msdyn_budget ?? 0,
      render: (p) => {
        if (p.msdyn_budget == null) return <span className="text-sm text-muted-foreground">—</span>;
        return <span className="text-sm text-muted-foreground tabular-nums">{currencyFmt.format(p.msdyn_budget)}</span>;
      },
    },
    {
      key: 'proj_programdue',
      header: 'Due',
      sortable: true,
      getValue: (p) => p.proj_programdue ?? '',
      render: (p) => {
        if (!p.proj_programdue) return <span className="text-sm text-muted-foreground">—</span>;
        const isOverdue = new Date(p.proj_programdue) < new Date();
        return (
          <span className={cn('text-sm', isOverdue ? 'text-rose-500 font-medium' : 'text-muted-foreground')}>
            {fmtDateOnly(p.proj_programdue)}
          </span>
        );
      },
    },
    {
      key: 'proj_programstart',
      header: 'Program Start',
      sortable: true,
      defaultHidden: true,
      getValue: (p) => p.proj_programstart ?? '',
      render: (p) => <span className="text-sm text-muted-foreground">{p.proj_programstart ? fmtDateOnly(p.proj_programstart) : '—'}</span>,
    },
    {
      key: 'createdon',
      header: 'Created On',
      sortable: true,
      defaultHidden: true,
      getValue: (p) => p.createdon ?? '',
      render: (p) => <span className="text-sm text-muted-foreground">{p.createdon ? fmtDateOnly(p.createdon) : '—'}</span>,
    },
    {
      key: '_createdby_value',
      header: 'Created By',
      sortable: true,
      defaultHidden: true,
      getValue: (p) => p['_createdby_value@OData.Community.Display.V1.FormattedValue'] ?? '',
      render: (p) => <span className="text-sm text-muted-foreground">{p['_createdby_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}</span>,
    },
    {
      key: 'modifiedon',
      header: 'Modified On',
      sortable: true,
      defaultHidden: true,
      getValue: (p) => p.modifiedon ?? '',
      render: (p) => <span className="text-sm text-muted-foreground">{p.modifiedon ? fmtDateOnly(p.modifiedon) : '—'}</span>,
    },
    {
      key: '_modifiedby_value',
      header: 'Modified By',
      sortable: true,
      defaultHidden: true,
      getValue: (p) => p['_modifiedby_value@OData.Community.Display.V1.FormattedValue'] ?? '',
      render: (p) => <span className="text-sm text-muted-foreground">{p['_modifiedby_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      {navigating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <LoadingOverlay isLoading label="Loading program..." />
        </div>
      )}
      <PageHeader title="Programs" subtitle="Program entities grouping related projects" />
      <ErrorBanner error={error as Error | null} />
      <DataTable
        data={enriched}
        columns={columns}
        keyExtractor={(p) => p.msdyn_projectprogramid}
        storageKey="cfr_program_list_view"
        tableKey="programs"
        onActiveColumnsChange={setActiveCols}
        exportFileName="Programs"
        defaultSortKey="pmo_programid"
        defaultSortDir="desc"
        forceDefaultSort
        pageSize={20}
        searchPlaceholder="Search programs..."
        searchFn={(p, q) =>
          [p.pmo_programid, p.msdyn_name, p.msdyn_description, p['_proj_manager_value@OData.Community.Display.V1.FormattedValue']]
            .some((v) => v?.toLowerCase().includes(q.toLowerCase()))
        }
        onRowClick={(p) => {
          setNavigating(true);
          navigate(`/programs/${p.msdyn_projectprogramid}`);
        }}
        actionButton={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Network className="h-3.5 w-3.5" />
              {visiblePrograms.length} program{visiblePrograms.length !== 1 ? 's' : ''}
            </div>
            <Button size="sm" onClick={() => navigate('/intake/new')}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Submit Request
            </Button>
          </div>
        }
        isLoading={isLoading}
        emptyMessage="No programs found. Click Submit Request to start a governed intake."
      />
    </div>
  );
}
