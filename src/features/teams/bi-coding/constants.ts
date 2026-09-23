/**
 * BI Coding team — identity constants.
 *
 * BI_CODING_TEAM_ID is the Dataverse team GUID for the BI (Business Intelligence)
 * primary team. This value gates the Coding tab, spec badges, and velocity card
 * so they only appear on BI-owned projects.
 *
 * The placeholder GUID below must be replaced with the actual Dataverse team GUID
 * after the team is provisioned in DEV (one-line edit, single extension point).
 * Using a well-known constant avoids scattering the GUID throughout the codebase.
 *
 * Sourced from: pac env list-team (DEV environment) once BI team exists.
 * Pattern established by payer-initiatives/constants.ts.
 */

/**
 * Dataverse team GUID for the BI team.
 *
 * The custom-Owner BI team is being phased out (see
 * scripts/migrate-pmo-teams-to-aad.py) — future gating relies on the
 * BI_CODING_TEAM_NAMES match against the AAD Office Group team, which has
 * different GUIDs on DEV vs PROD. This constant is kept as a
 * back-compat legacy value: PROD's custom-Owner Business Intelligence
 * GUID, so anyone still on the custom team activates the pack until the
 * migration re-points them. Set to the empty string once the custom team
 * is deactivated.
 */
export const BI_CODING_TEAM_ID = '2bf57f02-9f3a-ed11-9db0-000d3a14af62';
/**
 * Team names that should activate the BI feature pack. DEV's AAD team is
 * just "Business Intelligence"; PROD's is prefixed with the tenant name.
 */
export const BI_CODING_TEAM_NAMES = [
  'Business Intelligence',
  'Coram Finance RevCycle - Business Intelligence',
];
export const BI_CODING_DISPLAY = 'Business Intelligence';
