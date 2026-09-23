/**
 * The UAT tab on the project detail page.
 *
 * ENABLEMENT IS THE PARENT'S JOB. ProjectDetailPage.tsx calls useUatProjectTabEnabled and
 * renders neither the trigger nor this content when the tab is off, so this component does
 * not re-check. Re-checking here would let the trigger and the content disagree, which is
 * how a tab ends up visible but empty.
 *
 * LIKE-SURFACE PARITY, STRUCTURAL RATHER THAN REMEMBERED. This tab is the per-project twin
 * of the cross-project UAT area declared in ../routes.tsx, which records the pairing as
 * `alsoRenderedBy`. Both render the same `TestCaseTable`, so a grid, search, filter or
 * state feature added to one is on the other by construction — the component standards name
 * the alternative ("implemented on the standalone queue page, forgotten on the tab") as a
 * recurring delivery defect, and one shared component is the only way to stop relying on
 * whoever remembers.
 *
 * THIS IS WHERE A TEST CASE IS CREATED. The project is unambiguous here and fixed for the
 * life of the case, so the dialog needs no project question. The cross-project list
 * deliberately offers no create button for exactly that reason — see TestCaseListPage.
 *
 * Runs, defects and coverage belong on the case's own detail page, reachable by clicking a
 * row. The evidence panel here is the PROJECT's own — sign-off packs and anything that
 * belongs to the UAT effort rather than to one test case.
 */
import { useState } from 'react';
import { Plus, Upload, CalendarRange } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../../components/ui/button';
import { useUatTestCases } from '../../../hooks/useUatTestCases';
import { TestCaseTable } from '../components/TestCaseTable';
import { TestCaseCreateDialog } from '../components/TestCaseCreateDialog';
import { UatEvidenceFor } from '../components/UatAttachmentMounts';
import { UatProjectSettingsPanel } from '../components/UatProjectSettingsPanel';

export interface ProjectUatTabProps {
  /** The project whose UAT records this tab shows. */
  projectId: string;
}

export function ProjectUatTab({ projectId }: ProjectUatTabProps) {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const { data: testCases = [], isLoading, isError, refetch } = useUatTestCases(projectId);

  return (
    // Keyed on the project so switching projects remounts rather than reusing state that
    // belongs to the previous one — including an open create dialog aimed at it.
    <div key={projectId} className="space-y-4">
      <TestCaseTable
        testCases={testCases}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        onRowClick={(row) => navigate(`/uat/test-cases/${row.pmo_uattestcaseid}`)}
        // Every row would carry this project's name; a column that says the same thing on
        // every row costs width and tells the reader nothing.
        showProject={false}
        storageKey="cfr_uat_project_test_case_view"
        actionButton={
          <div className="flex gap-2">
            {/* The import needs a project, and here it is unambiguous — so this entry point
                carries it in the URL and the wizard never has to ask. */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/uat/import?projectId=${projectId}`)}
            >
              <Upload className="mr-1.5 h-4 w-4" aria-hidden />
              Import
            </Button>
            {/* The only way to reach the cycles page, which is why T021's reachability guard
                refused it as a nav-less non-detail route until it became `uat/cycles/:projectId`. */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/uat/cycles/${projectId}`)}
            >
              <CalendarRange className="mr-1.5 h-4 w-4" aria-hidden />
              Cycles
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              New test case
            </Button>
          </div>
        }
      />

      <UatEvidenceFor parent="Project" recordId={projectId} projectId={projectId} />

      {/* Settings last: the tab opens on the work, not on its configuration. Enablement,
          the ITPR reference, the default template and the bypass all live here (T044/T045). */}
      <details className="rounded-md border border-border">
        <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
          UAT settings for this project
        </summary>
        <div className="px-4 pb-4 pt-2">
          <UatProjectSettingsPanel projectId={projectId} />
        </div>
      </details>

      <TestCaseCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={projectId}
        onCreated={(id) => navigate(`/uat/test-cases/${id}`)}
      />
    </div>
  );
}

export default ProjectUatTab;
