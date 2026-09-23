/**
 * UAT test case, plus the typed coverage junction and the tag vocabulary.
 *
 * pmo_testdata is one free-form field replacing the legacy 40+ Epic-specific
 * columns. Test data is data, not schema.
 *
 * pmo_uatcoveragelink is an EXPLICIT junction, not a native N:N, because it carries a
 * coverage type and is directly aggregatable. The decisive reason is in data-model.md
 * 2.3: the legacy system modelled the same link both as an N:N and as a shadow
 * lookup, so which one any row used was unknowable without inspecting data. One
 * junction means there is exactly one way to relate a requirement to a test case.
 *
 * Deleting a test case with coverage links is REFUSED by the platform (Restrict).
 * Unlink first — see progress.md finding 17.
 */
import type { ActiveState } from './common.model';
import type { UatExternalTrackerFields, UatProjectReferenceFields } from './uatRequirement.model';

export interface UatTestCase extends ActiveState, UatExternalTrackerFields, UatProjectReferenceFields {
  pmo_uattestcaseid: string;
  /** Autonumber, TC-00000. Never set on create or update. */
  pmo_name: string;
  pmo_title: string;
  pmo_objective: string | null;
  pmo_scenario: string | null;
  pmo_preconditions: string | null;
  /** Free-form. Replaces the legacy 40+ Epic-specific columns. */
  pmo_testdata: string | null;
  /** Global pmo_uatpriority set. */
  pmo_priority: number | null;
  /**
   * Global pmo_uatexecutionstatus set. DERIVED and written on save by the app from
   * the case's current run — deliberately not a Dataverse rollup. Rollups recalculate
   * on a platform schedule and cannot back a live board, and the legacy
   * rollup-plus-calculated-string chain is the direct cause of its misleading "FAIL".
   */
  pmo_executionstatus: number | null;
  /** Global pmo_uatsource set: Template / Import / AdHoc. */
  pmo_source: number | null;
  /** Null for an ad-hoc case; a deleted template does not delete its cases. */
  _pmo_template_value: string | null;
  _pmo_cycle_value: string | null;
  _pmo_importbatch_value: string | null;
  _pmo_assignedtester_value: string | null;
  pmo_plannedstart: string | null;
  pmo_plannedend: string | null;
  pmo_estimatedminutes: number | null;
  createdon: string;
  modifiedon: string;
}

export interface UatTestCaseUpdate {
  pmo_title?: string;
  pmo_objective?: string | null;
  pmo_scenario?: string | null;
  pmo_preconditions?: string | null;
  pmo_testdata?: string | null;
  pmo_priority?: number | null;
  pmo_executionstatus?: number | null;
  pmo_source?: number | null;
  pmo_plannedstart?: string | null;
  pmo_plannedend?: string | null;
  pmo_estimatedminutes?: number | null;
  pmo_externalsystem?: number | null;
  pmo_externalkey?: string | null;
  pmo_externalid?: string | null;
  pmo_externalurl?: string | null;
  pmo_externalstatus?: string | null;
  pmo_externalsyncedon?: string | null;
  'pmo_Template@odata.bind'?: string | null;
  'pmo_Cycle@odata.bind'?: string | null;
  'pmo_ImportBatch@odata.bind'?: string | null;
  'pmo_AssignedTester@odata.bind'?: string | null;
  'pmo_Project@odata.bind'?: string | null;
  'pmo_ProjectRef@odata.bind'?: string | null;
}

export interface UatTestCaseCreate extends UatTestCaseUpdate {
  pmo_title: string;
}

export interface UatCoverageLink extends ActiveState {
  pmo_uatcoveragelinkid: string;
  pmo_name: string | null;
  _pmo_requirement_value: string;
  _pmo_testcase_value: string;
  /** Global pmo_uatcoveragetype set: Verifies / Partially Verifies / Related / Blocks. */
  pmo_coveragetype: number | null;
  pmo_notes: string | null;
  createdon: string;
}

export interface UatCoverageLinkCreate {
  pmo_name?: string | null;
  pmo_coveragetype?: number | null;
  pmo_notes?: string | null;
  /** Both required: the junction has no meaning with one end missing. */
  'pmo_Requirement@odata.bind': string;
  'pmo_TestCase@odata.bind': string;
}

export interface UatCoverageLinkUpdate {
  pmo_coveragetype?: number | null;
  pmo_notes?: string | null;
}

export interface UatTag extends ActiveState {
  pmo_uattagid: string;
  pmo_name: string;
  /** A CSS colour token or hex value for the chip. */
  pmo_colour: string | null;
  createdon: string;
}

export interface UatTagCreate {
  pmo_name: string;
  pmo_colour?: string | null;
}

/**
 * Attaches one tag to one UAT record. Exactly one parent lookup is set per row,
 * enforced in this service layer rather than by a plugin — the same contract
 * pmo_uatattachment uses.
 */
export interface UatTagLink extends ActiveState {
  pmo_uattaglinkid: string;
  pmo_name: string | null;
  _pmo_tag_value: string;
  _pmo_testcase_value: string | null;
  _pmo_requirement_value: string | null;
  _pmo_testrun_value: string | null;
  _pmo_defect_value: string | null;
  _pmo_cycle_value: string | null;
  _pmo_importbatch_value: string | null;
  _pmo_project_value: string | null;
  _pmo_projectref_value: string | null;
  createdon: string;
}
