import { useNavigate } from 'react-router-dom';
import { FileBarChart2 } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { DataTable, type DataTableColumn } from '../../components/data-table';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { useStatusReports } from '../../hooks/useStatusReports';
import type { StatusReport } from '../../models/statusReport.model';
import { fmtDateOnly } from '../../lib/dateOnly';

export function StatusReportListPage() {
  const navigate = useNavigate();
  const { data: reports = [], isLoading, error } = useStatusReports();

  const columns: DataTableColumn<StatusReport>[] = [
    {
      key: 'msdyn_name',
      header: 'Report',
      sortable: true,
      getValue: (r) => r.msdyn_name,
      render: (r) => {
        const projectId = r._msdyn_project_value;
        if (!projectId) return <span className="font-medium text-foreground">{r.msdyn_name}</span>;
        return (
          <button
            className="font-medium text-primary hover:underline text-left"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/projects/${projectId}?tab=status#sr-${r.msdyn_projectstatusreportid}`);
            }}
          >
            {r.msdyn_name}
          </button>
        );
      },
    },
    {
      key: '_msdyn_project_value',
      header: 'Project',
      sortable: true,
      getValue: (r) => r['_msdyn_project_value@OData.Community.Display.V1.FormattedValue'] ?? '',
      render: (r) => {
        const projectName = r['_msdyn_project_value@OData.Community.Display.V1.FormattedValue'];
        const projectId = r._msdyn_project_value;
        if (!projectName) return <span className="text-sm text-muted-foreground">—</span>;
        return (
          <button
            className="text-sm text-primary hover:underline text-left"
            onClick={(e) => {
              e.stopPropagation();
              if (projectId) navigate(`/projects/${projectId}`);
            }}
          >
            {projectName}
          </button>
        );
      },
    },
    {
      key: '_proj_submitter_value',
      header: 'Submitted By',
      sortable: true,
      getValue: (r) => r['_proj_submitter_value@OData.Community.Display.V1.FormattedValue'] ?? '',
      render: (r) => (
        <span className="text-sm text-muted-foreground">
          {r['_proj_submitter_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}
        </span>
      ),
    },
    {
      key: 'proj_reportingdate',
      header: 'Report Date',
      sortable: true,
      getValue: (r) => r.proj_reportingdate ?? r.createdon ?? '',
      render: (r) => {
        const date = r.proj_reportingdate ?? r.createdon;
        return (
          <span className="text-sm text-muted-foreground">
            {fmtDateOnly(date)}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Status Reports" subtitle="Cross-project status reports and updates" />
      <ErrorBanner error={error as Error | null} />
      <DataTable
        data={reports}
        columns={columns}
        keyExtractor={(r) => r.msdyn_projectstatusreportid}
        searchPlaceholder="Search reports..."
        searchFn={(r, q) =>
          [r.msdyn_name, r['_msdyn_project_value@OData.Community.Display.V1.FormattedValue']]
            .some((v) => v?.toLowerCase().includes(q.toLowerCase()))
        }
        onRowClick={(r) => {
          if (r._msdyn_project_value) navigate(`/projects/${r._msdyn_project_value}`);
        }}
        actionButton={
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileBarChart2 className="h-3.5 w-3.5" />
            {reports.length} report{reports.length !== 1 ? 's' : ''}
          </div>
        }
        isLoading={isLoading}
        emptyMessage="No status reports found. Reports are created from within a project."
      />
    </div>
  );
}
