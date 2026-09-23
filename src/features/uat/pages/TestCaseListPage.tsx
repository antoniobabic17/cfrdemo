/**
 * The cross-project test-case list — the UAT area's front door.
 *
 * IT REPLACES THE `uat` PLACEHOLDER, and that route is labelled "UAT Overview" in the
 * sidebar. A list of test cases is what the overview should be at this phase: the pace
 * chart and portfolio rollup arrive with T053, and until they exist an overview that shows
 * nothing but a heading is worse than one that shows the work. When T053 lands, the chart
 * belongs above this table, not instead of it.
 *
 * ONE GRID, TWO SURFACES. Everything about the table itself lives in `TestCaseTable` and is
 * shared with `ProjectUatTab`, because `routes.tsx` records the two as showing the same
 * records and the component standards name "shipped on the queue page, forgotten on the
 * tab" as a recurring defect. This page contributes the heading, the cross-project column,
 * and the fact that creation is not offered here.
 *
 * CREATION IS DELIBERATELY ABSENT FROM THIS SURFACE. A test case belongs to exactly one
 * project and cannot be moved afterwards (see `TestCaseCreateDialog`), so a "New test case"
 * button on a list spanning every project would first have to ask which project — turning
 * an irreversible choice into a dropdown on a page where the user has no project context.
 * The button lives on the project tab, where the answer is already unambiguous, and this
 * page says where to find it rather than leaving the absence to be puzzled over.
 */
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck } from 'lucide-react';
import { useAllUatTestCases } from '../../../hooks/useUatTestCases';
import { TestCaseTable } from '../components/TestCaseTable';

export function TestCaseListPage() {
  const navigate = useNavigate();
  const { data: testCases = [], isLoading, isError, refetch } = useAllUatTestCases();

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <ClipboardCheck className="mt-0.5 h-6 w-6 text-muted-foreground" aria-hidden />
        <div>
          <h1 className="text-xl font-semibold">UAT Overview</h1>
          <p className="text-sm text-muted-foreground">
            Every active test case across projects. To create one, open the project it
            belongs to and use its UAT tab — a test case cannot be moved between projects
            later.
          </p>
        </div>
      </div>

      <TestCaseTable
        testCases={testCases}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        onRowClick={(row) => navigate(`/uat/test-cases/${row.pmo_uattestcaseid}`)}
        showProject
        storageKey="cfr_uat_test_case_list_view"
      />
    </div>
  );
}

export default TestCaseListPage;
