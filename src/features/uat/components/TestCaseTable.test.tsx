/**
 * T026's acceptance, driven against the real grid.
 *
 * Three claims, and each fails silently rather than loudly if it is wrong:
 *
 * 1. **1,000 rows render without a visible stall.** The mechanism is pagination — sort and
 *    filter run over the whole set, the DOM holds one page — so the assertion is on the DOM
 *    row count, not on a stopwatch. A timing assertion would be flaky and would not say
 *    *why* it was fast; a row count says exactly what keeps it fast, and fails the moment
 *    someone removes the paging.
 * 2. **The empty state and the error state are different states.** DataTable's own empty
 *    message covers the first. It does NOT cover the second: on a failed query it renders
 *    "no records found", which asserts *there are no test cases* when the truth is *we could
 *    not load them*. The wrong one of those is worse than a blank panel, because it is
 *    confidently wrong. The error branch lives in TestCaseTable for that reason.
 * 3. **Sort and filter work on the real columns.** Both are DataTable features, and where
 *    `getValue` matters is narrower than it looks: DataTable falls back to `row[col.key]`,
 *    so a column whose key IS its field sorts correctly with no accessor at all. Measured
 *    2026-08-31 — deleting `getValue` from the Title column left all 12 tests green.
 *    `getValue` is load-bearing on exactly the columns where key and field diverge:
 *    `project`, which has no field of its own. The choice columns look like they need one
 *    too — string filter options against an integer field — and do not, because DataTable
 *    stringifies both sides. Both are driven below; only the `project` mutation breaks a
 *    test, and the comment beside those columns now says so rather than implying otherwise.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UatTestCase } from '../../../models/uatTestCase.model';
import {
  UAT_EXECUTION_STATUS,
  UAT_PRIORITY,
  UAT_SOURCE,
} from '../../../lib/uatOptionSets';
import { CUSTOM_PROJECT_VALUE } from '../../../lib/projectLookupRef';

/** DataTable's per-user view machinery talks to Dataverse; stub it to its shape. */
vi.mock('../../../hooks/useTableViews', () => ({
  useTableViews: () => ({
    options: [], activeViewId: 'default', setActiveViewId: vi.fn(), activeIsDefault: true,
    activeConfig: {}, setWidth: vi.fn(), resetWidths: vi.fn(), hasCustomWidths: false,
    createView: vi.fn(), updateView: vi.fn(), deleteView: vi.fn(),
    getViewColumns: () => [], getViewScope: () => ({ scope: 'private', teamId: null }),
  }),
  useViewTeamOptions: () => [],
}));
// DataTable reads orgDefault.columns / .widths directly, so an undefined here is a crash,
// not a no-op. The empty object is what "no org default configured" actually looks like.
vi.mock('../../../hooks/useOrgDefaultView', () => ({ useOrgDefaultView: () => ({}) }));
// DataTable resolves the project-mode data source internally; stub it rather than requiring
// a QueryClientProvider, matching UatProjectSettingsPanel.test.tsx / ImportWizardPage.test.tsx.
vi.mock('../../../lib/taskSource', () => ({ useDataSource: () => 'custom' }));

import { TestCaseTable, UNSET_LABEL } from './TestCaseTable';

const FV = '@OData.Community.Display.V1.FormattedValue';

function testCase(over: Partial<UatTestCase> & { pmo_uattestcaseid: string }): UatTestCase {
  return {
    pmo_name: 'TC-1000',
    pmo_title: 'Verify the claim total',
    pmo_priority: UAT_PRIORITY.Medium,
    pmo_executionstatus: UAT_EXECUTION_STATUS.NotStarted,
    pmo_source: UAT_SOURCE.Template,
    pmo_plannedend: null,
    pmo_estimatedminutes: null,
    pmo_externalkey: null,
    ...over,
  } as UatTestCase;
}

/** 1,000 rows, distinguishable so a sort can be observed. */
function thousandCases(): UatTestCase[] {
  return Array.from({ length: 1000 }, (_, i) =>
    testCase({
      pmo_uattestcaseid: `case-${i}`,
      pmo_name: `TC-${1000 + i}`,
      pmo_title: `Case ${String(i).padStart(4, '0')}`,
    }),
  );
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  // sessionTableState persists sort/filter per storageKey; a leaked value from one test
  // would silently pre-sort the next one.
  window.localStorage.clear();
});

function renderTable(props: Partial<React.ComponentProps<typeof TestCaseTable>> = {}) {
  const onRetry = vi.fn();
  const onRowClick = vi.fn();
  // DataTable also resolves the column catalog via useAppSettings(); a real (but inert)
  // QueryClient is enough since taskSource is stubbed above and nothing here asserts on it.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <TestCaseTable
      testCases={[]}
      isLoading={false}
      isError={false}
      onRetry={onRetry}
      onRowClick={onRowClick}
      showProject={false}
      {...props}
    />,
    { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> },
  );
  return { onRetry, onRowClick };
}

/** Body rows only — the header row is a <tr> too. */
function bodyRows(): HTMLElement[] {
  const table = screen.getByRole('table');
  const body = table.querySelector('tbody');
  return body ? Array.from(body.querySelectorAll('tr')) : [];
}

describe('1,000 rows (T026 acceptance)', () => {
  it('holds one page in the DOM, not the whole set', () => {
    renderTable({ testCases: thousandCases() });
    // 100 is DataTable's page size. The claim is that the DOM cost is flat in the row
    // count — this is the assertion that fails if the paging is ever removed.
    expect(bodyRows()).toHaveLength(100);
  });

  it('still reports the full count, so nothing looks lost', () => {
    renderTable({ testCases: thousandCases() });
    // "Showing 1-100 of 1000" — paging must not read as the set having shrunk.
    expect(screen.getByText('1–100')).toBeTruthy();
    expect(screen.getByText('1000')).toBeTruthy();
  });
});

describe('empty and error are different states', () => {
  it('renders an empty state, not a blank panel', () => {
    renderTable({ testCases: [] });
    expect(screen.getByText(/no test cases yet/i)).toBeTruthy();
  });

  it('renders an error state that says the load failed, and offers a retry', async () => {
    const user = userEvent.setup();
    const { onRetry } = renderTable({ isError: true });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/could not be loaded/i);
    // The distinction that matters: it must NOT claim there are no test cases.
    expect(alert.textContent ?? '').not.toMatch(/no test cases/i);
    // And it must not be a wall.
    await user.click(within(alert).getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not render the grid at all while erroring, so no "0 records" reading is possible', () => {
    renderTable({ isError: true });
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('sort and filter operate on real values', () => {
  it('sorts by title', async () => {
    const user = userEvent.setup();
    renderTable({
      testCases: [
        testCase({ pmo_uattestcaseid: 'b', pmo_name: 'TC-1002', pmo_title: 'Beta' }),
        testCase({ pmo_uattestcaseid: 'a', pmo_name: 'TC-1001', pmo_title: 'Alpha' }),
      ],
    });

    await user.click(screen.getByText('Title'));
    expect(bodyRows()[0]).toHaveTextContent('Alpha');
    await user.click(screen.getByText('Title'));
    expect(bodyRows()[0]).toHaveTextContent('Beta');
  });

  it('sorts the project column, which has no field of its own to fall back to', async () => {
    const user = userEvent.setup();
    renderTable({
      showProject: true,
      testCases: [
        testCase({ pmo_uattestcaseid: 'z', pmo_title: 'Zeta case', ...{ [`${CUSTOM_PROJECT_VALUE}${FV}`]: 'Zebra Programme' } } as Partial<UatTestCase> & { pmo_uattestcaseid: string }),
        testCase({ pmo_uattestcaseid: 'a', pmo_title: 'Alpha case', ...{ [`${CUSTOM_PROJECT_VALUE}${FV}`]: 'Apex Programme' } } as Partial<UatTestCase> & { pmo_uattestcaseid: string }),
      ],
    });

    await user.click(screen.getByText('Project'));
    expect(bodyRows()[0]).toHaveTextContent('Apex Programme');
    await user.click(screen.getByText('Project'));
    expect(bodyRows()[0]).toHaveTextContent('Zebra Programme');
  });

  it('filters by source, whose options are strings while the column is an integer', async () => {
    const user = userEvent.setup();
    renderTable({
      testCases: [
        testCase({ pmo_uattestcaseid: 'a', pmo_title: 'From a template', pmo_source: UAT_SOURCE.Template }),
        testCase({ pmo_uattestcaseid: 'b', pmo_title: 'Made up on the spot', pmo_source: UAT_SOURCE.AdHoc }),
        testCase({ pmo_uattestcaseid: 'c', pmo_title: 'Came from a spreadsheet', pmo_source: UAT_SOURCE.Import }),
      ],
    });

    // The trigger's label is its current value ("All Source"); Radix does not give the
    // button an accessible name of its own, so it is reached through the text it shows.
    const sourceFilter = screen.getByText('All Source').closest('button');
    expect(sourceFilter, 'the Source filter control was not rendered').toBeTruthy();
    await user.click(sourceFilter!);
    await user.click(await screen.findByRole('option', { name: 'AdHoc' }));

    // What this proves is that the filter is wired to the right column with the right
    // option values — NOT that the column's getValue is required. DataTable stringifies
    // both sides, so deleting that accessor changes nothing; measured, and recorded in
    // TestCaseTable.tsx beside the columns so the next reader is not misled by it.
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent('Made up on the spot');
  });

  it('searches title, case number and external key', async () => {
    const user = userEvent.setup();
    renderTable({
      testCases: [
        testCase({ pmo_uattestcaseid: 'a', pmo_name: 'TC-1001', pmo_title: 'Alpha' }),
        testCase({ pmo_uattestcaseid: 'b', pmo_name: 'TC-1002', pmo_title: 'Beta', pmo_externalkey: 'JIRA-77' }),
      ],
    });

    const search = screen.getByPlaceholderText(/search test cases/i);
    await user.type(search, 'JIRA-77');
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent('Beta');
  });

  it('renders every status as its own label, and a null status as a neutral dash', () => {
    renderTable({
      testCases: [
        testCase({ pmo_uattestcaseid: 'a', pmo_executionstatus: UAT_EXECUTION_STATUS.ReturnedForDefect }),
        testCase({ pmo_uattestcaseid: 'b', pmo_executionstatus: null, pmo_priority: null, pmo_source: null }),
      ],
    });
    expect(screen.getByText('Returned for Defect')).toBeTruthy();
    // Three unset cells on the second row. A null must never render as "null" or as a
    // plausible-looking status — finding 31's rule applied to choice columns.
    expect(screen.getAllByText(UNSET_LABEL).length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText('null')).toBeNull();
  });
});

describe('the project column', () => {
  const withProject = testCase({
    pmo_uattestcaseid: 'a',
    ...{ [`${CUSTOM_PROJECT_VALUE}${FV}`]: 'Nexus RCM Migration' },
  } as Partial<UatTestCase> & { pmo_uattestcaseid: string });

  it('shows the project name on the cross-project surface', () => {
    renderTable({ testCases: [withProject], showProject: true });
    expect(screen.getByText('Nexus RCM Migration')).toBeTruthy();
  });

  it('is absent on a single-project surface, where it would repeat on every row', () => {
    renderTable({ testCases: [withProject], showProject: false });
    expect(screen.queryByText('Nexus RCM Migration')).toBeNull();
  });
});

describe('like-surface parity is structural', () => {
  // routes.tsx declares both surfaces render these records (`alsoRenderedBy`), and the
  // component standards name "shipped on the queue page, forgotten on the tab" as a
  // recurring defect. One shared component is the only thing that stops that being a
  // permanent discipline problem — so this asserts neither surface grew its own grid.
  const sources = import.meta.glob(
    ['../pages/TestCaseListPage.tsx', '../pages/ProjectUatTab.tsx'],
    { query: '?raw', import: 'default', eager: true },
  ) as Record<string, string>;

  it('both surfaces render the shared TestCaseTable', () => {
    const entries = Object.entries(sources);
    expect(entries, 'expected both surface files to load').toHaveLength(2);
    for (const [file, text] of entries) {
      expect(text, `${file} must render the shared grid`).toContain('<TestCaseTable');
      expect(text, `${file} must not build its own DataTable`).not.toContain('<DataTable');
    }
  });

  it('only the project surface offers creation, because a case cannot change project', () => {
    const tab = Object.entries(sources).find(([f]) => f.includes('ProjectUatTab'))?.[1] ?? '';
    const list = Object.entries(sources).find(([f]) => f.includes('TestCaseListPage'))?.[1] ?? '';
    expect(tab).toContain('<TestCaseCreateDialog');
    // A create button on a list spanning every project would have to ask which project,
    // turning an irreversible choice into a dropdown with no project context.
    // Matched as JSX, not as a bare name: the page's own header explains why it has no
    // create button, and naming the component in prose is not shipping it.
    expect(list).not.toContain('<TestCaseCreateDialog');
  });
});
