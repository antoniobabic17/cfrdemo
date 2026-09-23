/**
 * Friendly entity-set keys for the UAT tables.
 *
 * Mirrors the role `ENTITY_SETS` in lib/constants.ts plays for the rest of the app,
 * but lives here and is DERIVED from the generated uatDataSources.ts rather than
 * hand-typed, for two reasons:
 *
 *   1. constants.ts's own header marks `ENTITY_SETS` as owned by the Platform
 *      Domain Owner ("OWNERSHIP [HIGH-RISK]"), and CONTRIBUTING.md lists the file
 *      in the High-Risk Tier. A feature adding 15 keys to it is exactly the kind of
 *      change that needs coordination rather than a quiet append.
 *   2. uatDataSources.ts is generated from the environment and already holds the
 *      authoritative entity set names. Re-typing them here would create a second
 *      place to get `pmo_uatimportbatchs` wrong.
 *
 * The indirection is not free — one more hop when reading a service — but it buys a
 * single source of truth for a set of strings whose failure mode is a runtime
 * "Data source not found" rather than a build error.
 */
import { UAT_ENTITY_SET_BY_LOGICAL_NAME } from './uatDataSources';

export const UAT_ENTITY_SETS = {
  template:         UAT_ENTITY_SET_BY_LOGICAL_NAME.pmo_uattemplate,
  templateQuestion: UAT_ENTITY_SET_BY_LOGICAL_NAME.pmo_uattemplatequestion,
  requirement:      UAT_ENTITY_SET_BY_LOGICAL_NAME.pmo_uatrequirement,
  testCase:         UAT_ENTITY_SET_BY_LOGICAL_NAME.pmo_uattestcase,
  coverageLink:     UAT_ENTITY_SET_BY_LOGICAL_NAME.pmo_uatcoveragelink,
  tag:              UAT_ENTITY_SET_BY_LOGICAL_NAME.pmo_uattag,
  tagLink:          UAT_ENTITY_SET_BY_LOGICAL_NAME.pmo_uattaglink,
  cycle:            UAT_ENTITY_SET_BY_LOGICAL_NAME.pmo_uatcycle,
  testRun:          UAT_ENTITY_SET_BY_LOGICAL_NAME.pmo_uattestrun,
  testRunAnswer:    UAT_ENTITY_SET_BY_LOGICAL_NAME.pmo_uattestrunanswer,
  defect:           UAT_ENTITY_SET_BY_LOGICAL_NAME.pmo_uatdefect,
  attachment:       UAT_ENTITY_SET_BY_LOGICAL_NAME.pmo_uatattachment,
  projectSetting:   UAT_ENTITY_SET_BY_LOGICAL_NAME.pmo_uatprojectsetting,
  importBatch:      UAT_ENTITY_SET_BY_LOGICAL_NAME.pmo_uatimportbatch,
  importRow:        UAT_ENTITY_SET_BY_LOGICAL_NAME.pmo_uatimportrow,
} as const;

export type UatEntitySetKey = keyof typeof UAT_ENTITY_SETS;
