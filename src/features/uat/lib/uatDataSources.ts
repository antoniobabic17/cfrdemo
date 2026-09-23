/**
 * UAT Dataverse data sources, GENERATED FROM THE ENVIRONMENT.
 *
 * DO NOT EDIT BY HAND. Regenerate with:
 *   pwsh -File scripts/uat/Export-UatDataSources.ps1
 *
 * Source: Nexus RCM - DEV. Every entitySetName below was read from
 * EntityDefinitions and then proven by a live GET returning 200.
 *
 * ENTITY SET NAMES ARE NOT DERIVABLE. Dataverse appends "s" rather than
 * applying English pluralization, so pmo_uatimportbatch becomes
 * pmo_uatimportbatchs -- not ...batches. Getting one wrong does not fail the
 * build; it throws at call time with "Data source not found: No Dataverse
 * data source found for table: ...", which is why this file is generated and
 * why uatDataSources.test.ts cross-checks it against the two registries that
 * have to agree with it.
 *
 * A table is only queryable at runtime if it appears in ALL THREE of:
 *   this file, app/src/lib/dataverseClient.ts DATAVERSE_SOURCES,
 *   and app/power.config.json databaseReferences["default.cds"].dataSources.
 */

export interface UatDataSource {
  /** Dataverse logical (singular) table name. */
  readonly logicalName: string;
  /** OData entity set name. Read from the platform, never derived. */
  readonly entitySetName: string;
  /** Primary key attribute, i.e. `${logicalName}id`. */
  readonly idAttribute: string;
}

export const UAT_DATA_SOURCES: readonly UatDataSource[] = [
  { logicalName: 'pmo_uattemplate', entitySetName: 'pmo_uattemplates', idAttribute: 'pmo_uattemplateid' },
  { logicalName: 'pmo_uattemplatequestion', entitySetName: 'pmo_uattemplatequestions', idAttribute: 'pmo_uattemplatequestionid' },
  { logicalName: 'pmo_uatrequirement', entitySetName: 'pmo_uatrequirements', idAttribute: 'pmo_uatrequirementid' },
  { logicalName: 'pmo_uattestcase', entitySetName: 'pmo_uattestcases', idAttribute: 'pmo_uattestcaseid' },
  { logicalName: 'pmo_uatcoveragelink', entitySetName: 'pmo_uatcoveragelinks', idAttribute: 'pmo_uatcoveragelinkid' },
  { logicalName: 'pmo_uattag', entitySetName: 'pmo_uattags', idAttribute: 'pmo_uattagid' },
  { logicalName: 'pmo_uattaglink', entitySetName: 'pmo_uattaglinks', idAttribute: 'pmo_uattaglinkid' },
  { logicalName: 'pmo_uatcycle', entitySetName: 'pmo_uatcycles', idAttribute: 'pmo_uatcycleid' },
  { logicalName: 'pmo_uattestrun', entitySetName: 'pmo_uattestruns', idAttribute: 'pmo_uattestrunid' },
  { logicalName: 'pmo_uattestrunanswer', entitySetName: 'pmo_uattestrunanswers', idAttribute: 'pmo_uattestrunanswerid' },
  { logicalName: 'pmo_uatdefect', entitySetName: 'pmo_uatdefects', idAttribute: 'pmo_uatdefectid' },
  { logicalName: 'pmo_uatattachment', entitySetName: 'pmo_uatattachments', idAttribute: 'pmo_uatattachmentid' },
  { logicalName: 'pmo_uatprojectsetting', entitySetName: 'pmo_uatprojectsettings', idAttribute: 'pmo_uatprojectsettingid' },
  { logicalName: 'pmo_uatimportbatch', entitySetName: 'pmo_uatimportbatchs', idAttribute: 'pmo_uatimportbatchid' },
  { logicalName: 'pmo_uatimportrow', entitySetName: 'pmo_uatimportrows', idAttribute: 'pmo_uatimportrowid' },
] as const;

/** Entity set name by logical name, for call sites that hold a logical name. */
export const UAT_ENTITY_SET_BY_LOGICAL_NAME: Readonly<Record<string, string>> = {
  pmo_uattemplate: 'pmo_uattemplates',
  pmo_uattemplatequestion: 'pmo_uattemplatequestions',
  pmo_uatrequirement: 'pmo_uatrequirements',
  pmo_uattestcase: 'pmo_uattestcases',
  pmo_uatcoveragelink: 'pmo_uatcoveragelinks',
  pmo_uattag: 'pmo_uattags',
  pmo_uattaglink: 'pmo_uattaglinks',
  pmo_uatcycle: 'pmo_uatcycles',
  pmo_uattestrun: 'pmo_uattestruns',
  pmo_uattestrunanswer: 'pmo_uattestrunanswers',
  pmo_uatdefect: 'pmo_uatdefects',
  pmo_uatattachment: 'pmo_uatattachments',
  pmo_uatprojectsetting: 'pmo_uatprojectsettings',
  pmo_uatimportbatch: 'pmo_uatimportbatchs',
  pmo_uatimportrow: 'pmo_uatimportrows',
} as const;

/** Every UAT entity set name, for the registration cross-checks. */
export const UAT_ENTITY_SET_NAMES: readonly string[] = UAT_DATA_SOURCES.map(
  (source) => source.entitySetName,
);
