/**
 * The test-case grid — ONE component, rendered by BOTH surfaces.
 *
 * LIKE-SURFACE PARITY, MADE STRUCTURAL. `routes.tsx` records that the cross-project UAT
 * area and the project-detail UAT tab show the same records (`alsoRenderedBy`), and the
 * component standards name the recurring defect: a grid feature — search, a filter, an
 * empty state — shipped on the standalone queue page and forgotten on the matching tab.
 * Two grids would make that a discipline problem forever, exactly as two hand-maintained
 * route lists would. So the columns, the states and the row behaviour live here once, and
 * each surface supplies only its own data and heading. This is the same reason `UAT_ROUTES`
 * is one list feeding two files.
 *
 * THE ERROR STATE IS THIS COMPONENT'S JOB. `DataTable` handles search, sort, filter,
 * loading and empty, but not a failed query — on error it renders "no records found",
 * which says *there are no test cases* rather than *we could not load them*. Those are
 * different statements and only one of them is true. TemplateListPage.tsx made the same
 * point for templates; this is the shared version of it.
 *
 * 1,000 ROWS ARE NOT A PROBLEM AND THE REASON IS PAGINATION, NOT LUCK. `DataTable` sorts
 * and filters the full set and renders one page of 100, so the DOM cost is flat in the row
 * count. T026's acceptance asks for 1,000 rows without a visible stall; a test drives that
 * many through this component and asserts one page is rendered.
 *
 * STATUS IS DISPLAYED FROM THE STORED COLUMN, NOT RE-DERIVED. `pmo_executionstatus` is
 * written on save by `lib/uatStatus.ts` from the case's current run. Re-deriving it here
 * would need every case's runs — 1,000 extra queries for a list — and would be a second
 * answer to a question already answered. A grid reads what was written.
 */
import { AlertTriangle } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../../../components/data-table';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  UAT_EXECUTION_STATUS,
  UAT_EXECUTION_STATUS_LABELS,
  UAT_PRIORITY,
  UAT_PRIORITY_LABELS,
  UAT_SOURCE,
  UAT_SOURCE_LABELS,
} from '../../../lib/uatOptionSets';
import { readProjectName } from '../../../lib/projectLookupRef';
import type { UatTestCase } from '../../../models/uatTestCase.model';

/** Shown wherever a choice column is null. Neutral, and not a domain term — finding 31. */
export const UNSET_LABEL = '—';

/**
 * Badge tone per execution status.
 *
 * Returned for Defect and Blocked both read destructive: each needs someone to act, which is
 * what separates them from work merely underway. Note what is NOT here: there is no "failed"
 * appearance, because the status set has no Fail member — that absence is the whole point of the
 * status vocabulary (FR-022), and a red "Fail"-looking badge would reintroduce by styling exactly
 * what the data model removed.
 */
function statusVariant(status: number | null): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case UAT_EXECUTION_STATUS.ReturnedForDefect: return 'destructive';
    // Blocked is destructive too, and that is the point of it existing. The owner's instruction
    // was that a blocked case must SHOW blocked; a tone that blended into In Process would put
    // the word on screen and still bury it on a board.
    case UAT_EXECUTION_STATUS.Blocked: return 'destructive';
    case UAT_EXECUTION_STATUS.Completed: return 'default';
    case UAT_EXECUTION_STATUS.InProcess: return 'secondary';
    default: return 'outline';
  }
}

function priorityVariant(priority: number | null): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (priority) {
    case UAT_PRIORITY.Critical: return 'destructive';
    case UAT_PRIORITY.High: return 'default';
    default: return 'outline';
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) return UNSET_LABEL;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? UNSET_LABEL : parsed.toLocaleDateString();
}

/** Options built from the option sets, so a new member appears without an edit here. */
const STATUS_FILTER_OPTIONS = Object.values(UAT_EXECUTION_STATUS).map((value) => ({
  value: String(value),
  label: UAT_EXECUTION_STATUS_LABELS[value],
}));
const PRIORITY_FILTER_OPTIONS = Object.values(UAT_PRIORITY).map((value) => ({
  value: String(value),
  label: UAT_PRIORITY_LABELS[value],
}));
const SOURCE_FILTER_OPTIONS = Object.values(UAT_SOURCE).map((value) => ({
  value: String(value),
  label: UAT_SOURCE_LABELS[value],
}));

export interface TestCaseTableProps {
  testCases: UatTestCase[];
  isLoading: boolean;
  isError: boolean;
  /** Retry the failed query. Required, because an error state with no way out is a wall. */
  onRetry: () => void;
  onRowClick: (testCase: UatTestCase) => void;
  /** The "New test case" button, or nothing where the surface cannot create one. */
  actionButton?: React.ReactNode;
  /**
   * Show which project each case belongs to. True on the cross-project surface, false on
   * the project tab where every row would carry the same value — a column that says the
   * same thing on every row costs width and tells the reader nothing.
   *
   * REQUIRED, with no default. Both surfaces answer it explicitly, so a default would be a
   * branch nothing exercises — and the wrong default is the kind of thing that ships
   * because no test could have noticed.
   */
  showProject: boolean;
  /** Distinguishes the two surfaces' persisted sort/filter state. */
  storageKey?: string;
}

export function TestCaseTable({
  testCases,
  isLoading,
  isError,
  onRetry,
  onRowClick,
  actionButton,
  showProject,
  storageKey,
}: TestCaseTableProps) {
  const columns: DataTableColumn<UatTestCase>[] = [
    {
      key: 'pmo_name',
      header: 'Case',
      sortable: true,
      defaultWidth: 110,
      getValue: (row) => row.pmo_name,
      render: (row) => <span className="font-medium tabular-nums">{row.pmo_name}</span>,
    },
    {
      key: 'pmo_title',
      header: 'Title',
      sortable: true,
      defaultWidth: 320,
      getValue: (row) => row.pmo_title,
    },
    ...(showProject
      ? [{
          key: 'project',
          header: 'Project',
          sortable: true,
          defaultWidth: 200,
          // undefined rather than a placeholder from readProjectName, so the dash is this
          // component's decision and stays consistent with every other unset cell.
          getValue: (row: UatTestCase) => readProjectName(row) ?? '',
          render: (row: UatTestCase) => (
            <span>{readProjectName(row) ?? UNSET_LABEL}</span>
          ),
        } satisfies DataTableColumn<UatTestCase>]
      : []),
    {
      // Note on getValue across these columns: DataTable falls back to `row[col.key]` and
      // stringifies both sides of a comparison, so on every column whose key IS its field
      // the accessor is explicitness rather than necessity — measured 2026-08-31 by
      // deleting them and watching the tests stay green. It is load-bearing on exactly one
      // column, `project`, which has no field of its own. Kept here anyway because these
      // read as a set with it, and because getExportValue's documented fallback order runs
      // through getValue.
      key: 'pmo_executionstatus',
      header: 'Status',
      sortable: true,
      filterable: true,
      filterMode: 'multi',
      filterOptions: STATUS_FILTER_OPTIONS,
      defaultWidth: 150,
      getValue: (row) => (row.pmo_executionstatus == null ? '' : String(row.pmo_executionstatus)),
      getExportValue: (row) =>
        row.pmo_executionstatus == null
          ? UNSET_LABEL
          : UAT_EXECUTION_STATUS_LABELS[row.pmo_executionstatus],
      render: (row) =>
        row.pmo_executionstatus == null
          ? <span className="text-muted-foreground">{UNSET_LABEL}</span>
          : (
              <Badge variant={statusVariant(row.pmo_executionstatus)}>
                {UAT_EXECUTION_STATUS_LABELS[row.pmo_executionstatus]}
              </Badge>
            ),
    },
    {
      key: 'pmo_priority',
      header: 'Priority',
      sortable: true,
      filterable: true,
      filterMode: 'multi',
      filterOptions: PRIORITY_FILTER_OPTIONS,
      defaultWidth: 120,
      getValue: (row) => (row.pmo_priority == null ? '' : String(row.pmo_priority)),
      getExportValue: (row) =>
        row.pmo_priority == null ? UNSET_LABEL : UAT_PRIORITY_LABELS[row.pmo_priority],
      render: (row) =>
        row.pmo_priority == null
          ? <span className="text-muted-foreground">{UNSET_LABEL}</span>
          : (
              <Badge variant={priorityVariant(row.pmo_priority)}>
                {UAT_PRIORITY_LABELS[row.pmo_priority]}
              </Badge>
            ),
    },
    {
      key: 'pmo_source',
      header: 'Source',
      sortable: true,
      filterable: true,
      filterOptions: SOURCE_FILTER_OPTIONS,
      defaultWidth: 120,
      getValue: (row) => (row.pmo_source == null ? '' : String(row.pmo_source)),
      getExportValue: (row) =>
        row.pmo_source == null ? UNSET_LABEL : UAT_SOURCE_LABELS[row.pmo_source],
      render: (row) => (
        <span className="text-muted-foreground">
          {row.pmo_source == null ? UNSET_LABEL : UAT_SOURCE_LABELS[row.pmo_source]}
        </span>
      ),
    },
    {
      key: 'pmo_plannedend',
      header: 'Planned end',
      sortable: true,
      defaultWidth: 130,
      defaultHidden: true,
      getValue: (row) => row.pmo_plannedend ?? '',
      render: (row) => <span className="tabular-nums">{formatDate(row.pmo_plannedend)}</span>,
    },
    {
      key: 'pmo_estimatedminutes',
      header: 'Est. minutes',
      sortable: true,
      defaultWidth: 120,
      defaultHidden: true,
      getValue: (row) => row.pmo_estimatedminutes ?? 0,
      render: (row) => (
        <span className="tabular-nums">{row.pmo_estimatedminutes ?? UNSET_LABEL}</span>
      ),
    },
  ];

  if (isError) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-6"
      >
        <p className="flex items-center gap-2 text-sm font-medium text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          Test cases could not be loaded.
        </p>
        <p className="text-sm text-muted-foreground">
          Nothing has been lost — this is a read that failed. Try again, and if it keeps
          failing the connection to Dataverse is the thing to check.
        </p>
        <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>
      </div>
    );
  }

  return (
    <DataTable
      data={testCases}
      columns={columns}
      keyExtractor={(row) => row.pmo_uattestcaseid}
      searchPlaceholder="Search test cases…"
      searchFn={(row, query) => {
        const q = query.toLowerCase();
        return (row.pmo_title ?? '').toLowerCase().includes(q)
          || (row.pmo_name ?? '').toLowerCase().includes(q)
          || (row.pmo_externalkey ?? '').toLowerCase().includes(q);
      }}
      onRowClick={onRowClick}
      actionButton={actionButton}
      isLoading={isLoading}
      emptyMessage="No test cases yet. Create one to start recording what was verified."
      storageKey={storageKey}
    />
  );
}
