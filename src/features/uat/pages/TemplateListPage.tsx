/**
 * UAT template list.
 *
 * The entry point to the thing this whole rebuild exists for: test content as DATA.
 * A template here is a row, its questions are rows, and adding a fourteenth question
 * is an insert rather than a schema change plus two business-rule edits plus a form
 * edit.
 *
 * LIKE-SURFACE PARITY. Templates are the one deliberate single-surface UAT area — see
 * routes.tsx. They are configuration authored once and reused, so there is no
 * per-project template list; a per-project copy would reintroduce the duplication the
 * model removes. Two OTHER surfaces consume the template lookup and will need a picker
 * (pmo_uatprojectsetting.pmo_defaulttemplate and pmo_uattestcase.pmo_template); those
 * pickers must show the same identity this list shows — name, version, active — or a
 * user cannot tell two versions apart when choosing one. Recorded in progress.md
 * finding 41.
 *
 * ERROR STATE IS EXPLICIT. DataTable handles search, sort, filter, loading and empty,
 * but not a failed query — on error it would render as "no records found", which reads
 * as "there are no templates" rather than "we could not load them". Only two pages in
 * this app currently distinguish those; the component standards require it, so this one
 * does.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileStack, Plus, AlertTriangle } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../../../components/data-table';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { useUatTemplates } from '../../../hooks/useUatTemplates';
import type { UatTemplate } from '../../../models/uatTemplate.model';
import { TemplateCreateDialog } from '../components/TemplateCreateDialog';

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString();
}

export function TemplateListPage() {
  const navigate = useNavigate();
  const { data: templates = [], isLoading, isError, refetch } = useUatTemplates();
  const [createOpen, setCreateOpen] = useState(false);

  const columns: DataTableColumn<UatTemplate>[] = [
    {
      key: 'pmo_name',
      header: 'Template',
      sortable: true,
      getValue: (row) => row.pmo_name,
      render: (row) => <span className="font-medium">{row.pmo_name}</span>,
    },
    {
      key: 'pmo_version',
      header: 'Version',
      sortable: true,
      getValue: (row) => row.pmo_version ?? 0,
      render: (row) => <span className="tabular-nums">v{row.pmo_version ?? 1}</span>,
    },
    {
      key: 'pmo_isactive',
      header: 'Status',
      sortable: true,
      filterable: true,
      filterOptions: [
        { value: 'active', label: 'Active' },
        { value: 'inactive', label: 'Inactive' },
      ],
      getValue: (row) => (row.pmo_isactive === false ? 'inactive' : 'active'),
      render: (row) =>
        row.pmo_isactive === false
          ? <Badge variant="outline">Inactive</Badge>
          : <Badge>Active</Badge>,
    },
    {
      key: 'pmo_defaultestimatedminutes',
      header: 'Est. minutes',
      sortable: true,
      getValue: (row) => row.pmo_defaultestimatedminutes ?? 0,
      render: (row) =>
        row.pmo_defaultestimatedminutes == null
          ? <span className="text-muted-foreground">—</span>
          : <span className="tabular-nums">{row.pmo_defaultestimatedminutes}</span>,
    },
    {
      key: 'modifiedon',
      header: 'Last changed',
      sortable: true,
      getValue: (row) => row.modifiedon,
      render: (row) => <span className="text-muted-foreground">{formatDate(row.modifiedon)}</span>,
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">UAT Templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The questions a tester is asked. Editing a template changes future runs;
            completed runs keep the wording they were answered against.
          </p>
        </div>
      </div>

      {isError ? (
        // Distinct from "no templates". A failed load must not read as an empty library.
        <div className="rounded-xl border border-border bg-muted/30 p-12 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" aria-hidden />
          <p className="text-sm font-medium">Templates could not be loaded</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This is a load failure, not an empty library — no template has been lost.
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <DataTable<UatTemplate>
          data={templates}
          columns={columns}
          keyExtractor={(row) => row.pmo_uattemplateid}
          isLoading={isLoading}
          searchPlaceholder="Search templates by name…"
          searchFn={(row, query) => row.pmo_name.toLowerCase().includes(query.toLowerCase())}
          defaultSortKey="pmo_name"
          defaultSortDir="asc"
          onRowClick={(row) => navigate(`/uat/templates/${row.pmo_uattemplateid}`)}
          emptyMessage="No templates yet. Create one to define what a tester is asked."
          exportFileName="uat-templates"
          tableKey="uatTemplates"
          actionButton={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New template
            </Button>
          }
        />
      )}

      {templates.length === 0 && !isLoading && !isError && (
        <div className="flex items-start gap-3 rounded-lg border border-dashed p-4 text-sm">
          <FileStack className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="space-y-1">
            <p className="font-medium">What a template is for</p>
            <p className="text-muted-foreground">
              A template holds the ordered questions a tester answers. Change it and the
              next run asks the new set — no deployment, no schema change.
            </p>
          </div>
        </div>
      )}

      <TemplateCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => navigate(`/uat/templates/${id}`)}
      />
    </div>
  );
}

export default TemplateListPage;
