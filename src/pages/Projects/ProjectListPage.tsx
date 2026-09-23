import { useMemo, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { FolderKanban, Loader2, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { resolveSaeDisplay } from '../../lib/sae';
import { PageHeader } from '../../components/layout/PageHeader';
import { DataTable, type DataTableColumn } from '../../components/data-table';
import { StatusBadge } from '../../components/common/StatusBadge';
import { HealthBadge } from '../../components/common/HealthBadge';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { LoadingOverlay } from '../../components/common/LoadingOverlay';
import { Button } from '../../components/ui/button';
import { useProjects } from '../../hooks/useProjects';
import { usePrograms } from '../../hooks/usePrograms';
import { useDeletingProjects } from '../../hooks/useDeletingProjects';
import type { Project } from '../../models/project.model';
import { OVERALL_HEALTH, PROJECT_STATUS_LABELS, PROJECT_STATUS_OPTIONS } from '../../lib/constants';
import { resolveSidebarTeamName, isPayerInitiativesTeamId } from '../../lib/pmoTeams';
import { useCurrentUserTeams } from '../../hooks/useCurrentUserTeams';
import { useEffectiveAdminRole } from '../../providers/ConfigurationProvider';
import { usePmoTeamsForIntake } from '../../hooks/useIntakeLookups';
import { useDataSource, usesCustomTables } from '../../lib/taskSource';
import { useViewExtraSelect } from '../../hooks/useViewExtraSelect';
import { useLatestProjectNotes } from '../../hooks/useProjectNotes';
import { notePlainText } from '../../lib/noteEnvelope';
import { useAppSettings } from '../../hooks/useAppSettings';
import { useAllTrackingLabelsForType } from '../../hooks/useTrackingLabels';
import { SETTING_TRACKING_LABELS, DEFAULT_TRACKING_LABELS } from '../../lib/constants';
import { fmtDateOnly } from '../../lib/dateOnly';

/** Normalize msdyn_progress (stored 0-1 in Dataverse) to a 0-100 integer. */
function normPct(raw: number | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  return raw > 0 && raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
}

function ProgressBar({ value }: { value?: number }) {
  const pct = value ?? 0;
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 40 ? 'bg-primary' : 'bg-amber-500';
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">{pct}%</span>
    </div>
  );
}

const HEALTH_FILTER_OPTIONS = [
  { value: String(OVERALL_HEALTH.OnTrack), label: 'On Track' },
  { value: String(OVERALL_HEALTH.AtRisk), label: 'At Risk' },
  { value: String(OVERALL_HEALTH.OffTrack), label: 'Off Track' },
];

const STATUS_FILTER_OPTIONS = [
  { value: '0', label: 'Active' },
  { value: '1', label: 'Inactive' },
];

export function ProjectListPage() {
  const navigate = useNavigate();
    const qc = useQueryClient();
    const _prefetchSource = useDataSource(); // used for prefetch queryKey
    const prefetchedRef = useRef(new Set<string>());
    // First-open feedback: ProjectDetailPage is a lazy() chunk. On the very
    // first navigation the chunk isn't cached, so React keeps THIS list
    // mounted during the Suspense transition (the router does not fall back
    // to the Suspense boundary for an already-rendered tree). That's the
    // "stuck on Projects for ~2s" the user reported. Rendering our own
    // overlay the instant a row is clicked gives immediate feedback; it
    // unmounts when the detail route takes over. Later opens are instant
    // (chunk cached) so the overlay just flashes imperceptibly.
    const [navigating, setNavigating] = useState(false);

    // Prefetch: on hover over a project row, start downloading the detail
    // page chunk and the project data in parallel. By the time the user
    // clicks, both are already in cache and navigation is instant.
    function handleRowHover(p: Project) {
      const id = p.msdyn_projectid;
      if (prefetchedRef.current.has(id)) return; // already prefetched this row
      prefetchedRef.current.add(id);
      // 1. Warm the lazy chunk.
      void import('./ProjectDetailPage');
      // 2. Prefetch project detail query.
      void qc.prefetchQuery({
        queryKey: ['projects', 'detail', _prefetchSource, id],
        queryFn: () => usesCustomTables(_prefetchSource)
          ? import('../../api/customProjects.api').then((m) => m.getCustomProject(id))
          : import('../../api/projects.api').then((m) => m.getProject(id)),
        staleTime: 30 * 1000,
      });
    }
  const [searchParams] = useSearchParams();
  // Arriving from the Dashboard 'At Risk / Off Track' KPI tile: ?health=at,off
  // seeds the Health multi-select so the landed list matches the tile's count.
  // Overrides any persisted view for this visit; the Clear button resets it.
  const healthParam = searchParams.get('health');
  const initialFilters = useMemo(() => {
    if (!healthParam) return undefined;
    const map: Record<string, string> = {
      at: String(OVERALL_HEALTH.AtRisk),
      off: String(OVERALL_HEALTH.OffTrack),
      on: String(OVERALL_HEALTH.OnTrack),
    };
    const vals = healthParam.split(',').map((k) => map[k.trim()]).filter(Boolean);
    return vals.length ? { proj_overallhealth: vals } : undefined;
  }, [healthParam]);
  const dataSource = useDataSource();
  const [activeCols, setActiveCols] = useState<string[]>([]);
  // Validate active view columns against the catalog so only real Dataverse
  // attributes reach $select (source-scoped for the pss/custom project tables).
  const projectExtraSelect = useViewExtraSelect('projects', activeCols, dataSource);
  const { data: projects = [], isLoading, error } = useProjects(undefined, projectExtraSelect);
  const { data: programs = [] } = usePrograms();
  const { data: appSettings = [] } = useAppSettings();
  // Bulk-load all tracking labels for the Projects gallery filter.
  // One query covers all projects; no per-row fetching needed.
  const { data: labelsByProjectRaw } = useAllTrackingLabelsForType('Project');
  const labelsByProject = labelsByProjectRaw ?? new Map<string, string[]>();

  // Admin-configured available labels (for filter options).
  const trackingLabelFilterOptions = (() => {
    const raw = appSettings.find((s) => s.pmo_key === SETTING_TRACKING_LABELS)?.pmo_value;
    const list: string[] = (() => {
      if (!raw) return [...DEFAULT_TRACKING_LABELS];
      try { const p = JSON.parse(raw); return Array.isArray(p) ? p : [...DEFAULT_TRACKING_LABELS]; }
      catch { return [...DEFAULT_TRACKING_LABELS]; }
    })();
    return list.map((l) => ({ value: l, label: l }));
  })();
  // Issue Number (M-#) column is visible/selectable ONLY to admins or Payer
  // Initiatives team members. Membership detection mirrors GovernedIntakeWizard:
  // match the AAD-env-specific team id via the raw (Dataverse-named) team list.
  const adminRole = useEffectiveAdminRole();
  const myTeams = useCurrentUserTeams();
  const { data: pmoTeamsRaw = [] } = usePmoTeamsForIntake();
  const canSeeIssueNumber = adminRole !== 'none'
    || (!!myTeams && [...myTeams].some((id) => isPayerInitiativesTeamId(id, pmoTeamsRaw)));

  const deletingIds = useDeletingProjects();
  // Optimistic delete: a project being cascade-deleted in the background is
  // removed from the list IMMEDIATELY (like a deleted task vanishing from the
  // board) rather than lingering greyed-out for the ~10s cascade. If the
  // cascade fails, the detail-page catch invalidates ['projects'] and it returns.
  const visibleProjects = useMemo(
    () => projects.filter((p) => !deletingIds.has(p.msdyn_projectid)),
    [projects, deletingIds],
  );
  // "Last Note" is an opt-in/lazy grid column: the note fetch only runs once
  // the column is actually in the active view (DataTable reports its visible
  // column keys). Notes attach polymorphically to the project record for the
  // active data source — pmo_project (custom) or msdyn_project (pss).
  const projectNoteTypeCode = usesCustomTables(dataSource) ? 'pmo_project' as const : 'msdyn_project' as const;
  const [lastNoteEnabled, setLastNoteEnabled] = useState(false);
  // The note objectid is the project's GUID. Under the same-GUID contract the
  // custom pmo_project row shares the msdyn_project GUID (customProjects.api.ts
  // normalizes msdyn_projectid = the pmo_project record id), so msdyn_projectid
  // is the correct key for BOTH sources. (Project.pmo_projectid is the friendly
  // PROJ-##### display string — NOT the GUID — so it must not be used here.)
  const noteProjectId = (p: Project): string | undefined => p.msdyn_projectid;
  const lastNoteProjectIds = useMemo(
    () => (lastNoteEnabled
      ? visibleProjects.map(noteProjectId).filter((id): id is string => !!id)
      : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lastNoteEnabled, visibleProjects, dataSource],
  );
  const { data: latestNoteByProject } = useLatestProjectNotes(
    lastNoteProjectIds, projectNoteTypeCode, lastNoteEnabled,
  );
  const programFilterOptions = programs.map((p) => ({
    value: p.msdyn_projectprogramid,
    label: p.msdyn_name,
  }));

  // Team + Project Manager options are derived client-side from the loaded
  // projects array (deduplicated by GUID), so no extra fetch is needed.
  const teamFilterOptions = useMemo(() => {
    // Use the admin-configured display name (same source the sidebar uses)
    // so filter labels match the pills users click through from the nav.
    const m = new Map<string, string>();
    for (const p of projects) {
      const id = p._pmo_primaryteam_value;
      const rawName = p['_pmo_primaryteam_value@OData.Community.Display.V1.FormattedValue'];
      if (id && rawName && !m.has(id)) m.set(id, resolveSidebarTeamName(id, rawName, appSettings));
    }
    return [...m]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [projects, appSettings]);

  const pmFilterOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) {
      const id = p._msdyn_projectmanager_value;
      const name = p['_msdyn_projectmanager_value@OData.Community.Display.V1.FormattedValue'];
      if (id && name && !m.has(id)) m.set(id, name);
    }
    return [...m]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [projects]);

  const columns: DataTableColumn<Project>[] = [
    {
      key: 'pmo_projectid',
      header: 'Project ID',
      sortable: true,
      getValue: (p) => p.pmo_projectid ?? '',
      render: (p) =>
        p.pmo_projectid ? (
          <span className="font-mono text-xs tabular-nums text-foreground">{p.pmo_projectid}</span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      key: 'pmo_legacyprojectid',
      header: 'Legacy ID',
      sortable: true,
      getValue: (p) => p.pmo_legacyprojectid ?? '',
      render: (p) =>
        p.pmo_legacyprojectid ? (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {p.pmo_legacyprojectid}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      key: 'msdyn_subject',
      header: 'Project',
      sortable: true,
      getValue: (p) => p.msdyn_subject,
      render: (p) => {
        const isRowDeleting = deletingIds.has(p.msdyn_projectid);
        return (
          <div className="min-w-0 flex items-center gap-2">
            {isRowDeleting && (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-label="Deleting" />
            )}
            <span className="font-medium text-foreground">{p.msdyn_subject}</span>
            {isRowDeleting ? (
              <span className="ml-1 text-[10px] font-medium text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                Deleting…
              </span>
            ) : (
              p['proj_stage@OData.Community.Display.V1.FormattedValue'] && (
                <span className="ml-2 text-[10px] font-medium text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                  {p['proj_stage@OData.Community.Display.V1.FormattedValue']}
                </span>
              )
            )}
          </div>
        );
      },
    },
    {
      key: 'statecode',
      header: 'Status',
      // Status (record state Active/Inactive) filter is admin-only; non-admins
      // still see the column but not the dropdown. Project Status stays for all.
      filterable: adminRole !== 'none',
      filterOptions: STATUS_FILTER_OPTIONS,
      getValue: (p) => String(p.statecode ?? 0),
      render: (p) => <StatusBadge statecode={p.statecode} />,
    },
    {
      key: 'pmo_projectstatus',
      header: 'Project Status',
      sortable: true,
      filterable: true,
      filterMode: 'multi',
      filterOptions: [...PROJECT_STATUS_OPTIONS],
      // Filter options carry the numeric optionset code (e.g. "508640001"); the
      // DataTable multi-filter matches String(getValue) against those values.
      // Return the code here (render shows the human label) so selecting a
      // status matches rows — returning the label produced an empty grid.
      getValue: (p) => (p.pmo_projectstatus != null ? String(p.pmo_projectstatus) : ''),
      render: (p) => (
        <span className="text-sm text-muted-foreground">
          {p.pmo_projectstatus != null ? (PROJECT_STATUS_LABELS[p.pmo_projectstatus] ?? '—') : '—'}
        </span>
      ),
    },
    {
      key: '_msdyn_projectmanager_value',
      header: 'Project Manager',
      sortable: true,
      filterable: true,
      filterMode: 'multi',
      filterOptions: pmFilterOptions,
      getValue: (p) => p._msdyn_projectmanager_value ?? '',
      render: (p) => (
        <span className="text-sm text-muted-foreground">
          {p['_msdyn_projectmanager_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}
        </span>
      ),
    },
    {
      key: '_pmo_primaryteam_value',
      header: 'Team',
      sortable: true,
      filterable: true,
      filterMode: 'multi',
      filterOptions: teamFilterOptions,
      getValue: (p) => p._pmo_primaryteam_value ?? '',
      getExportValue: (p) => {
        const raw = p['_pmo_primaryteam_value@OData.Community.Display.V1.FormattedValue'];
        const id = p._pmo_primaryteam_value;
        return id && raw ? resolveSidebarTeamName(id, raw, appSettings) : (raw ?? '');
      },
      render: (p) => {
        const raw = p['_pmo_primaryteam_value@OData.Community.Display.V1.FormattedValue'];
        const id = p._pmo_primaryteam_value;
        const label = id && raw ? resolveSidebarTeamName(id, raw, appSettings) : (raw ?? '—');
        return <span className="text-sm text-muted-foreground">{label}</span>;
      },
    },
    {
      key: '_msdyn_program_value',
      header: 'Program',
      sortable: true,
      filterable: true,
      filterOptions: programFilterOptions,
      getValue: (p) => p._msdyn_program_value ?? '',
      render: (p) => (
        <span className="text-sm text-muted-foreground">
          {p['_msdyn_program_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}
        </span>
      ),
    },
    {
      key: 'proj_overallhealth',
      header: 'Health',
      filterable: true,
      filterMode: 'multi',
      filterOptions: HEALTH_FILTER_OPTIONS,
      getValue: (p) => String(p.proj_overallhealth ?? ''),
      render: (p) => <HealthBadge value={p.proj_overallhealth} />,
    },
    {
      key: 'msdyn_progress',
      header: 'Progress',
      sortable: true,
      getValue: (p) => normPct(p.msdyn_progress),
      getExportValue: (p) => `${normPct(p.msdyn_progress)}%`,
      render: (p) => <ProgressBar value={normPct(p.msdyn_progress)} />,
    },
    {
      // Default-view Finish Date column: the manual, PMO-owned proj_actualfinishdate
      // (editable on the Details tab), NOT the PSS task-derived msdyn_finish.
      key: 'proj_actualfinishdate',
      header: 'Finish Date',
      sortable: true,
      getValue: (p) => p.proj_actualfinishdate ?? '',
      getExportValue: (p) => (p.proj_actualfinishdate ? fmtDateOnly(p.proj_actualfinishdate) : ''),
      render: (p) => {
        if (!p.proj_actualfinishdate) return <span className="text-sm text-muted-foreground">—</span>;
        const isOverdue = new Date(p.proj_actualfinishdate) < new Date() && normPct(p.msdyn_progress) < 100;
        return (
          <span className={cn('text-sm', isOverdue ? 'text-rose-500 font-medium' : 'text-muted-foreground')}>
            {fmtDateOnly(p.proj_actualfinishdate)}
          </span>
        );
      },
    },
    {
      key: 'msdyn_scheduledstart',
      header: 'Scheduled Start',
      sortable: true,
      defaultHidden: true,
      getValue: (p) => p.msdyn_scheduledstart ?? '',
      getExportValue: (p) => (p.msdyn_scheduledstart ? fmtDateOnly(p.msdyn_scheduledstart) : ''),
      render: (p) => <span className="text-sm text-muted-foreground">{p.msdyn_scheduledstart ? fmtDateOnly(p.msdyn_scheduledstart) : '—'}</span>,
    },
    {
      key: 'createdon',
      header: 'Created On',
      sortable: true,
      defaultHidden: true,
      getValue: (p) => p.createdon ?? '',
      getExportValue: (p) => (p.createdon ? fmtDateOnly(p.createdon) : ''),
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
      getExportValue: (p) => (p.modifiedon ? fmtDateOnly(p.modifiedon) : ''),
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
    // Issue Number (M-#): the linked HPI record's primary name, which an RCM
    // Power Automate flow keeps equal to rcm_issuenumber ("M-{SEQNUM}"). Read
    // straight off the lookup's FormattedValue already in LIST_SELECT — no fetch.
    // Gated: only pushed into the columns array for admins / Payer Initiatives
    // members, so it is neither selectable in the view editor nor exportable
    // for anyone else. defaultHidden keeps it out of the default view.
    ...(canSeeIssueNumber ? [{
      key: '_pmo_payerinitiatives_hpiissue_value',
      header: 'Issue Number',
      sortable: true,
      defaultHidden: true,
      getValue: (p: Project) => p['_pmo_payerinitiatives_hpiissue_value@OData.Community.Display.V1.FormattedValue'] ?? '',
      render: (p: Project) => (
        <span className="text-sm text-muted-foreground">
          {p['_pmo_payerinitiatives_hpiissue_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}
        </span>
      ),
    } as DataTableColumn<Project>] : []),
    // Strategic Account Executive (Payer Initiatives). Value lives in AAD
    // snapshot text columns (already in LIST_SELECT); the legacy systemuser
    // lookup's FormattedValue is usually empty, so a catalog lookup column
    // renders blank — this hand-authored column renders via resolveSaeDisplay()
    // so the SAE actually shows. Gated + defaultHidden like Issue Number.
    ...(canSeeIssueNumber ? [{
      key: 'pmo_payerinitiatives_saedisplayname',
      header: 'Strategic Account Executive',
      sortable: true,
      defaultHidden: true,
      getValue: (p: Project) => resolveSaeDisplay(p),
      render: (p: Project) => {
        const v = resolveSaeDisplay(p);
        return <span className="text-sm text-muted-foreground">{v || '—'}</span>;
      },
    } as DataTableColumn<Project>] : []),
    // Last Note: most recent note on the project (any author). App-layer —
    // populated lazily from useLatestProjectNotes only when this column is in
    // the active view. Shows body (marker-stripped, truncated) + author/date;
    // export carries the full body + author + date. NOTE: migrated cr87a notes
    // carry createdon = migration date, so "latest" can surface a migrated note
    // as newest; go-forward notes are accurate.
    {
      key: 'lastNote',
      header: 'Last Note',
      sortable: true,
      defaultHidden: true,
      className: 'max-w-[320px]',
      getValue: (p) => {
        const id = noteProjectId(p);
        const note = id ? latestNoteByProject?.get(id) : undefined;
        return note ? notePlainText(note.notetext) : '';
      },
      getExportValue: (p) => {
        const id = noteProjectId(p);
        const note = id ? latestNoteByProject?.get(id) : undefined;
        if (!note) return '';
        const body = notePlainText(note.notetext);
        const author = note['_createdby_value@OData.Community.Display.V1.FormattedValue'] ?? '';
        return author ? `${body} — ${author}` : body;
      },
      render: (p) => {
        const id = noteProjectId(p);
        const note = id ? latestNoteByProject?.get(id) : undefined;
        if (!note) return <span className="text-sm text-muted-foreground/60">—</span>;
        const body = notePlainText(note.notetext);
        const author = note['_createdby_value@OData.Community.Display.V1.FormattedValue'];
        return (
          <div className="min-w-0">
            <span className="block max-w-[320px] truncate text-sm" title={body}>{body || '—'}</span>
            {author && (
              <span className="block text-[11px] text-muted-foreground/70">
                {author}
              </span>
            )}
          </div>
        );
      },
    },
    // Last Note Date (Payer Initiatives): the createdon date of the most-recent
    // note, surfaced as its own sortable date column. Reuses the same lazily-
    // fetched latestNoteByProject map as Last Note (no extra query). Gated to
    // admins / Payer Initiatives members exactly like Issue Number + Last Note's
    // PI scoping, and defaultHidden so it never enters the default view.
    ...(canSeeIssueNumber ? [{
      key: 'lastNoteDate',
      header: 'Last Note Date',
      sortable: true,
      defaultHidden: true,
      getValue: (p: Project) => {
        const id = noteProjectId(p);
        const note = id ? latestNoteByProject?.get(id) : undefined;
        return note?.createdon ?? '';
      },
      getExportValue: (p: Project) => {
        const id = noteProjectId(p);
        const note = id ? latestNoteByProject?.get(id) : undefined;
        return note?.createdon ? fmtDateOnly(note.createdon) : '';
      },
      render: (p: Project) => {
        const id = noteProjectId(p);
        const note = id ? latestNoteByProject?.get(id) : undefined;
        return (
          <span className="text-sm text-muted-foreground">
            {note?.createdon ? fmtDateOnly(note.createdon) : '—'}
          </span>
        );
      },
    } as DataTableColumn<Project>] : []),
    {
      // Tracking Labels — virtual column backed by pmo_tracking rows, multi-select
      // filter so users can find projects tagged with any combination of labels.
      // getValue returns string[] (array-aware multi-filter match in data-table.tsx).
      key: 'trackingLabels',
      header: 'Tracking Label',
      filterable: true,
      filterMode: 'multi' as const,
      filterOptions: trackingLabelFilterOptions,
      getValue: (p: Project) => {
        const id = (p.msdyn_projectid ?? '').replace(/[{}]/g, '').toLowerCase();
        return labelsByProject.get(id) ?? [];
      },
      getExportValue: (p: Project) => {
        const id = (p.msdyn_projectid ?? '').replace(/[{}]/g, '').toLowerCase();
        return (labelsByProject.get(id) ?? []).join(', ');
      },
      render: (p: Project) => {
        const id = (p.msdyn_projectid ?? '').replace(/[{}]/g, '').toLowerCase();
        const lbls = labelsByProject.get(id) ?? [];
        if (!lbls.length) return <span className="text-sm text-muted-foreground">—</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {lbls.map((l) => (
              <span key={l} className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 whitespace-nowrap">
                {l}
              </span>
            ))}
          </div>
        );
      },
    },
  ];

  const activeCount = visibleProjects.filter(p => p.statecode === 0).length;

  return (
    <div className="space-y-6">
      {navigating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          {/* Reuse the same spinner + label the ProjectDetailPage shows while
              its data loads, so the instant click feedback and the detail-page
              loading state are visually identical. */}
          <LoadingOverlay isLoading label="Loading project..." />
        </div>
      )}
      <PageHeader
        title="Projects"
        subtitle={`${activeCount} active project${activeCount !== 1 ? 's' : ''} across all programs`}
      />
      <ErrorBanner error={error as Error | null} />
      <DataTable
        data={visibleProjects}
        columns={columns}
        keyExtractor={(p) => p.msdyn_projectid}
        storageKey="cfr_project_list_view"
        initialFilters={initialFilters}
        tableKey="projects"
        onActiveColumnsChange={(keys) => { setLastNoteEnabled(keys.includes('lastNote') || keys.includes('lastNoteDate')); setActiveCols(keys); }}
        exportFileName="Projects"
        defaultSortKey="pmo_projectid"
        defaultSortDir="desc"
        forceDefaultSort
        pageSize={50}
        searchPlaceholder="Search projects..."
        searchFn={(p, q) => {
          // Include the resolved (admin-override) team name so a user
          // searching by the sidebar label also finds the row.
          const rawTeam = p['_pmo_primaryteam_value@OData.Community.Display.V1.FormattedValue'];
          const teamId = p._pmo_primaryteam_value;
          const resolvedTeam = teamId && rawTeam ? resolveSidebarTeamName(teamId, rawTeam, appSettings) : rawTeam;
          return [
            p.pmo_projectid,
            p.pmo_legacyprojectid,
            p.msdyn_subject,
            p['_msdyn_projectmanager_value@OData.Community.Display.V1.FormattedValue'],
            rawTeam,
            resolvedTeam,
            p['_msdyn_program_value@OData.Community.Display.V1.FormattedValue'],
          ].some((v) => v?.toLowerCase().includes(q.toLowerCase()));
        }}
        onRowClick={(p) => {
          // Suppress navigation while a row is mid-delete — clicking it
          // would land on a project detail page that's about to 404.
          if (deletingIds.has(p.msdyn_projectid)) return;
          // Show the overlay synchronously so the click registers as
          // 'opening' even while the lazy detail chunk is still loading.
          setNavigating(true);
          navigate(`/projects/${p.msdyn_projectid}`);
        }}
        onRowHover={(p) => {
          if (deletingIds.has(p.msdyn_projectid)) return;
          handleRowHover(p);
        }}
        rowClassName={(p) =>
          deletingIds.has(p.msdyn_projectid)
            ? 'opacity-50 pointer-events-none bg-muted/40'
            : undefined
        }
        actionButton={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FolderKanban className="h-3.5 w-3.5" />
              {visibleProjects.length} total
            </div>
            <Button size="sm" onClick={() => navigate('/intake/new')}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Submit Request
            </Button>
          </div>
        }
        isLoading={isLoading}
        emptyMessage="No projects found. Click Submit Request to start a governed intake."
      />
    </div>
  );
}
