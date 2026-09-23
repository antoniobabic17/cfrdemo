/**
 * UAT option-set integers, GENERATED FROM THE ENVIRONMENT.
 *
 * DO NOT EDIT BY HAND. Regenerate with:
 *   pwsh -File scripts/uat/Export-UatOptionSets.ps1
 *
 * Source: Nexus RCM - DEV, solution CFRProjectManagement.
 * Every value below was read back from Dataverse, not predicted. That is gate
 * G-OPTINT, and it exists because data-model.md predicted these sets would land
 * at 893460300+ and the platform assigned 893460000+.
 *
 * NAMESPACED PER SET, DELIBERATELY. Every set in this environment starts at the
 * same base, so a bare integer is ambiguous: 893460000 is Pass in UAT_OUTCOME,
 * Staged in UAT_IMPORT_BATCH_STATUS, Staged in UAT_IMPORT_ROW_STATUS and
 * Verifies in UAT_COVERAGE_TYPE. Never flatten these into one map, and never
 * copy a number from one set to another -- it will be a valid integer for the
 * wrong column, and nothing will complain.
 *
 * Three choice columns are absent because their members are not settled:
 * pmo_uatdefect.pmo_category, pmo_uatdefect.pmo_assignedteam and
 * pmo_uattemplate.pmo_category. See specs/001-uat-manager-module/progress.md
 * finding 27. An empty map for them would look like completeness.
 */

/** `pmo_uatoutcome` (global) -- 5 members. Shared by pmo_uattestrun.pmo_result, pmo_uattestrunanswer.pmo_outcome and pmo_uatdefect.pmo_retestoutcome. Ends in In Process, never Skipped. */
export const UAT_OUTCOME = {
  Pass: 893460000,
  Fail: 893460001,
  Blocked: 893460002,
  NotApplicable: 893460003,
  InProcess: 893460004,
} as const;

export type UatOutcomeValue = (typeof UAT_OUTCOME)[keyof typeof UAT_OUTCOME];

/** Integer to display label for `pmo_uatoutcome`. */
export const UAT_OUTCOME_LABELS: Readonly<Record<number, string>> = {
  893460000: 'Pass',
  893460001: 'Fail',
  893460002: 'Blocked',
  893460003: 'Not Applicable',
  893460004: 'In Process',
} as const;

/** `pmo_uatexecutionstatus` (global) -- 5 members. Shared by pmo_uattestcase and pmo_uattestrun. */
export const UAT_EXECUTION_STATUS = {
  NotStarted: 893460000,
  InProcess: 893460001,
  Completed: 893460002,
  ReturnedForDefect: 893460003,
  Blocked: 893460004,
} as const;

export type UatExecutionStatusValue = (typeof UAT_EXECUTION_STATUS)[keyof typeof UAT_EXECUTION_STATUS];

/** Integer to display label for `pmo_uatexecutionstatus`. */
export const UAT_EXECUTION_STATUS_LABELS: Readonly<Record<number, string>> = {
  893460000: 'Not Started',
  893460001: 'In Process',
  893460002: 'Completed',
  893460003: 'Returned for Defect',
  893460004: 'Blocked',
} as const;

/** `pmo_uatresponsetype` (global) -- 7 members. The INPUT type of a template question. */
export const UAT_RESPONSE_TYPE = {
  Choice: 893460000,
  YesNo: 893460001,
  Text: 893460002,
  Number: 893460003,
  Currency: 893460004,
  Date: 893460005,
  Duration: 893460006,
} as const;

export type UatResponseTypeValue = (typeof UAT_RESPONSE_TYPE)[keyof typeof UAT_RESPONSE_TYPE];

/** Integer to display label for `pmo_uatresponsetype`. */
export const UAT_RESPONSE_TYPE_LABELS: Readonly<Record<number, string>> = {
  893460000: 'Choice',
  893460001: 'YesNo',
  893460002: 'Text',
  893460003: 'Number',
  893460004: 'Currency',
  893460005: 'Date',
  893460006: 'Duration',
} as const;

/** `pmo_uatrequirementtype` (global) -- 5 members. */
export const UAT_REQUIREMENT_TYPE = {
  Epic: 893460000,
  Story: 893460001,
  Requirement: 893460002,
  Task: 893460003,
  Spike: 893460004,
} as const;

export type UatRequirementTypeValue = (typeof UAT_REQUIREMENT_TYPE)[keyof typeof UAT_REQUIREMENT_TYPE];

/** Integer to display label for `pmo_uatrequirementtype`. */
export const UAT_REQUIREMENT_TYPE_LABELS: Readonly<Record<number, string>> = {
  893460000: 'Epic',
  893460001: 'Story',
  893460002: 'Requirement',
  893460003: 'Task',
  893460004: 'Spike',
} as const;

/** `pmo_uatrequirementstatus` (global) -- 5 members. */
export const UAT_REQUIREMENT_STATUS = {
  Defined: 893460000,
  InProgress: 893460001,
  Completed: 893460002,
  Accepted: 893460003,
  Rejected: 893460004,
} as const;

export type UatRequirementStatusValue = (typeof UAT_REQUIREMENT_STATUS)[keyof typeof UAT_REQUIREMENT_STATUS];

/** Integer to display label for `pmo_uatrequirementstatus`. */
export const UAT_REQUIREMENT_STATUS_LABELS: Readonly<Record<number, string>> = {
  893460000: 'Defined',
  893460001: 'In Progress',
  893460002: 'Completed',
  893460003: 'Accepted',
  893460004: 'Rejected',
} as const;

/** `pmo_uatpriority` (global) -- 4 members. Shared by requirement, test case and defect. */
export const UAT_PRIORITY = {
  Critical: 893460000,
  High: 893460001,
  Medium: 893460002,
  Low: 893460003,
} as const;

export type UatPriorityValue = (typeof UAT_PRIORITY)[keyof typeof UAT_PRIORITY];

/** Integer to display label for `pmo_uatpriority`. */
export const UAT_PRIORITY_LABELS: Readonly<Record<number, string>> = {
  893460000: 'Critical',
  893460001: 'High',
  893460002: 'Medium',
  893460003: 'Low',
} as const;

/** `pmo_uatcoveragetype` (global) -- 4 members. */
export const UAT_COVERAGE_TYPE = {
  Verifies: 893460000,
  PartiallyVerifies: 893460001,
  Related: 893460002,
  Blocks: 893460003,
} as const;

export type UatCoverageTypeValue = (typeof UAT_COVERAGE_TYPE)[keyof typeof UAT_COVERAGE_TYPE];

/** Integer to display label for `pmo_uatcoveragetype`. */
export const UAT_COVERAGE_TYPE_LABELS: Readonly<Record<number, string>> = {
  893460000: 'Verifies',
  893460001: 'Partially Verifies',
  893460002: 'Related',
  893460003: 'Blocks',
} as const;

/** `pmo_uatcyclestatus` (global) -- 4 members. */
export const UAT_CYCLE_STATUS = {
  Planned: 893460000,
  Active: 893460001,
  Complete: 893460002,
  Cancelled: 893460003,
} as const;

export type UatCycleStatusValue = (typeof UAT_CYCLE_STATUS)[keyof typeof UAT_CYCLE_STATUS];

/** Integer to display label for `pmo_uatcyclestatus`. */
export const UAT_CYCLE_STATUS_LABELS: Readonly<Record<number, string>> = {
  893460000: 'Planned',
  893460001: 'Active',
  893460002: 'Complete',
  893460003: 'Cancelled',
} as const;

/** `pmo_uatparenttype` (global) -- 7 members. Denormalized filter key on pmo_uatattachment. NOT the source of truth for which parent is set -- the lookups are. */
export const UAT_PARENT_TYPE = {
  TestCase: 893460000,
  TestRun: 893460001,
  Defect: 893460002,
  Requirement: 893460003,
  Cycle: 893460004,
  Project: 893460005,
  ImportBatch: 893460006,
} as const;

export type UatParentTypeValue = (typeof UAT_PARENT_TYPE)[keyof typeof UAT_PARENT_TYPE];

/** Integer to display label for `pmo_uatparenttype`. */
export const UAT_PARENT_TYPE_LABELS: Readonly<Record<number, string>> = {
  893460000: 'TestCase',
  893460001: 'TestRun',
  893460002: 'Defect',
  893460003: 'Requirement',
  893460004: 'Cycle',
  893460005: 'Project',
  893460006: 'ImportBatch',
} as const;

/** `pmo_uatsource` (global) -- 3 members. */
export const UAT_SOURCE = {
  Template: 893460000,
  Import: 893460001,
  AdHoc: 893460002,
} as const;

export type UatSourceValue = (typeof UAT_SOURCE)[keyof typeof UAT_SOURCE];

/** Integer to display label for `pmo_uatsource`. */
export const UAT_SOURCE_LABELS: Readonly<Record<number, string>> = {
  893460000: 'Template',
  893460001: 'Import',
  893460002: 'AdHoc',
} as const;

/** `pmo_uatattachmentcategory` (global) -- 6 members. */
export const UAT_ATTACHMENT_CATEGORY = {
  Screenshot: 893460000,
  TestEvidence: 893460001,
  DefectEvidence: 893460002,
  ImportSource: 893460003,
  SignOff: 893460004,
  Other: 893460005,
} as const;

export type UatAttachmentCategoryValue = (typeof UAT_ATTACHMENT_CATEGORY)[keyof typeof UAT_ATTACHMENT_CATEGORY];

/** Integer to display label for `pmo_uatattachmentcategory`. */
export const UAT_ATTACHMENT_CATEGORY_LABELS: Readonly<Record<number, string>> = {
  893460000: 'Screenshot',
  893460001: 'Test Evidence',
  893460002: 'Defect Evidence',
  893460003: 'Import Source',
  893460004: 'Sign-off',
  893460005: 'Other',
} as const;

/** `pmo_uatexternalsystem` (global) -- 3 members. Half of the external upsert key. NOT the ITPR -- see G-ITPR. */
export const UAT_EXTERNAL_SYSTEM = {
  None: 893460000,
  Jira: 893460001,
  AzureDevOps: 893460002,
} as const;

export type UatExternalSystemValue = (typeof UAT_EXTERNAL_SYSTEM)[keyof typeof UAT_EXTERNAL_SYSTEM];

/** Integer to display label for `pmo_uatexternalsystem`. */
export const UAT_EXTERNAL_SYSTEM_LABELS: Readonly<Record<number, string>> = {
  893460000: 'None',
  893460001: 'Jira',
  893460002: 'AzureDevOps',
} as const;

/** `pmo_uatdefectstatus` (global) -- 11 members. */
export const UAT_DEFECT_STATUS = {
  New: 893460000,
  Open: 893460001,
  InDevelopment: 893460002,
  ReadyForRetest: 893460003,
  Fixed: 893460004,
  RetestFailed: 893460005,
  Reopened: 893460006,
  Monitoring: 893460007,
  Deferred: 893460008,
  Closed: 893460009,
  Cancelled: 893460010,
} as const;

export type UatDefectStatusValue = (typeof UAT_DEFECT_STATUS)[keyof typeof UAT_DEFECT_STATUS];

/** Integer to display label for `pmo_uatdefectstatus`. */
export const UAT_DEFECT_STATUS_LABELS: Readonly<Record<number, string>> = {
  893460000: 'New',
  893460001: 'Open',
  893460002: 'In Development',
  893460003: 'Ready for Retest',
  893460004: 'Fixed',
  893460005: 'Retest Failed',
  893460006: 'Reopened',
  893460007: 'Monitoring',
  893460008: 'Deferred',
  893460009: 'Closed',
  893460010: 'Cancelled',
} as const;

/** `pmo_uatdefectseverity` (global) -- 4 members. Severity is how bad it is; priority is when it gets fixed. */
export const UAT_DEFECT_SEVERITY = {
  Critical: 893460000,
  High: 893460001,
  Medium: 893460002,
  Low: 893460003,
} as const;

export type UatDefectSeverityValue = (typeof UAT_DEFECT_SEVERITY)[keyof typeof UAT_DEFECT_SEVERITY];

/** Integer to display label for `pmo_uatdefectseverity`. */
export const UAT_DEFECT_SEVERITY_LABELS: Readonly<Record<number, string>> = {
  893460000: 'Critical',
  893460001: 'High',
  893460002: 'Medium',
  893460003: 'Low',
} as const;

/** `pmo_uatimportbatch.pmo_status` (local) -- 5 members. LOCAL set on pmo_uatimportbatch. */
export const UAT_IMPORT_BATCH_STATUS = {
  Staged: 893460000,
  Committing: 893460001,
  Completed: 893460002,
  CompletedWithErrors: 893460003,
  Cancelled: 893460004,
} as const;

export type UatImportBatchStatusValue = (typeof UAT_IMPORT_BATCH_STATUS)[keyof typeof UAT_IMPORT_BATCH_STATUS];

/** Integer to display label for `pmo_uatimportbatch.pmo_status`. */
export const UAT_IMPORT_BATCH_STATUS_LABELS: Readonly<Record<number, string>> = {
  893460000: 'Staged',
  893460001: 'Committing',
  893460002: 'Completed',
  893460003: 'Completed with Errors',
  893460004: 'Cancelled',
} as const;

/** `pmo_uatimportrow.pmo_status` (local) -- 4 members. LOCAL set on pmo_uatimportrow. A DIFFERENT vocabulary from the batch status that shares its integers. */
export const UAT_IMPORT_ROW_STATUS = {
  Staged: 893460000,
  Created: 893460001,
  Skipped: 893460002,
  Failed: 893460003,
} as const;

export type UatImportRowStatusValue = (typeof UAT_IMPORT_ROW_STATUS)[keyof typeof UAT_IMPORT_ROW_STATUS];

/** Integer to display label for `pmo_uatimportrow.pmo_status`. */
export const UAT_IMPORT_ROW_STATUS_LABELS: Readonly<Record<number, string>> = {
  893460000: 'Staged',
  893460001: 'Created',
  893460002: 'Skipped',
  893460003: 'Failed',
} as const;

/**
 * Every generated set, keyed by its export name, with the Dataverse source it
 * came from. uatOptionSets.test.ts walks this so a new set is covered without
 * the test needing an edit -- a test that has to be updated to cover new data
 * is a test that will not be.
 */
export const UAT_OPTION_SET_REGISTRY: Readonly<Record<string, { source: string; scope: 'global' | 'local'; values: Readonly<Record<string, number>>; labels: Readonly<Record<number, string>> }>> = {
  UAT_OUTCOME: { source: 'pmo_uatoutcome', scope: 'global', values: UAT_OUTCOME, labels: UAT_OUTCOME_LABELS },
  UAT_EXECUTION_STATUS: { source: 'pmo_uatexecutionstatus', scope: 'global', values: UAT_EXECUTION_STATUS, labels: UAT_EXECUTION_STATUS_LABELS },
  UAT_RESPONSE_TYPE: { source: 'pmo_uatresponsetype', scope: 'global', values: UAT_RESPONSE_TYPE, labels: UAT_RESPONSE_TYPE_LABELS },
  UAT_REQUIREMENT_TYPE: { source: 'pmo_uatrequirementtype', scope: 'global', values: UAT_REQUIREMENT_TYPE, labels: UAT_REQUIREMENT_TYPE_LABELS },
  UAT_REQUIREMENT_STATUS: { source: 'pmo_uatrequirementstatus', scope: 'global', values: UAT_REQUIREMENT_STATUS, labels: UAT_REQUIREMENT_STATUS_LABELS },
  UAT_PRIORITY: { source: 'pmo_uatpriority', scope: 'global', values: UAT_PRIORITY, labels: UAT_PRIORITY_LABELS },
  UAT_COVERAGE_TYPE: { source: 'pmo_uatcoveragetype', scope: 'global', values: UAT_COVERAGE_TYPE, labels: UAT_COVERAGE_TYPE_LABELS },
  UAT_CYCLE_STATUS: { source: 'pmo_uatcyclestatus', scope: 'global', values: UAT_CYCLE_STATUS, labels: UAT_CYCLE_STATUS_LABELS },
  UAT_PARENT_TYPE: { source: 'pmo_uatparenttype', scope: 'global', values: UAT_PARENT_TYPE, labels: UAT_PARENT_TYPE_LABELS },
  UAT_SOURCE: { source: 'pmo_uatsource', scope: 'global', values: UAT_SOURCE, labels: UAT_SOURCE_LABELS },
  UAT_ATTACHMENT_CATEGORY: { source: 'pmo_uatattachmentcategory', scope: 'global', values: UAT_ATTACHMENT_CATEGORY, labels: UAT_ATTACHMENT_CATEGORY_LABELS },
  UAT_EXTERNAL_SYSTEM: { source: 'pmo_uatexternalsystem', scope: 'global', values: UAT_EXTERNAL_SYSTEM, labels: UAT_EXTERNAL_SYSTEM_LABELS },
  UAT_DEFECT_STATUS: { source: 'pmo_uatdefectstatus', scope: 'global', values: UAT_DEFECT_STATUS, labels: UAT_DEFECT_STATUS_LABELS },
  UAT_DEFECT_SEVERITY: { source: 'pmo_uatdefectseverity', scope: 'global', values: UAT_DEFECT_SEVERITY, labels: UAT_DEFECT_SEVERITY_LABELS },
  UAT_IMPORT_BATCH_STATUS: { source: 'pmo_uatimportbatch.pmo_status', scope: 'local', values: UAT_IMPORT_BATCH_STATUS, labels: UAT_IMPORT_BATCH_STATUS_LABELS },
  UAT_IMPORT_ROW_STATUS: { source: 'pmo_uatimportrow.pmo_status', scope: 'local', values: UAT_IMPORT_ROW_STATUS, labels: UAT_IMPORT_ROW_STATUS_LABELS },
} as const;
