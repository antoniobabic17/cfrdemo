/**
 * Process & Project team — identity constants.
 *
 * PROCESS_PROJECT_TEAM_ID is the Dataverse team GUID for the Process & Project
 * primary team (Amy Hammock, Tina Hoag, Andrea Dodds and other members). This
 * value gates whatever team-specific surfaces get added to the feature pack
 * over time.
 *
 * Sourced from the PROD probe on 2026-06-30 while wiring up the "Act as
 * Process & Project" pill for admins. Same GUID exists in DEV — the CFR
 * PMO team-membership machinery keeps the ID stable across environments
 * (unlike role GUIDs which are per-BU).
 *
 * Pattern mirrors payer-initiatives/constants.ts.
 */

/** Dataverse team GUID for the Process & Project team. */
export const PROCESS_PROJECT_TEAM_ID = '166c959e-9a53-f111-bec6-00224834f663';
/**
 * Team names that should activate this feature pack. Kept alongside the GUID
 * so the pack works cross-env: on DEV the AAD Office Group team is called
 * "Process & Project", on PROD it's "Coram Finance RevCycle - Process &
 * Project Team". Either name match activates the pack.
 */
export const PROCESS_PROJECT_TEAM_NAMES = [
  'Process & Project',
  'Coram Finance RevCycle - Process & Project Team',
];
export const PROCESS_PROJECT_DISPLAY = 'Process & Project';
