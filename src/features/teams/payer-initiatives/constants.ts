/**
 * Payer Initiatives — team identity + route paths.
 *
 * TEAM_ID is the historic custom-Owner PMO team GUID on PROD. Kept for
 * back-compat and the impersonation pill (both key on GUID). The pack now
 * also lists PAYER_INITIATIVES_TEAM_NAMES so name-based matching in
 * useActiveTeamFeatures activates the pack for users on the AAD-synced
 * team even though its GUID differs per environment.
 *
 * Migration status (2026-07-01):
 *   - DEV team "Payer Initiatives"       teamtype=3 (AAD Office Group)
 *   - PROD team "Coram Finance RevCycle - Payer Initiatives" teamtype=3
 *   - PROD legacy custom Owner team GUID 39a012ac-... still exists but is
 *     being phased out by scripts/migrate-pmo-teams-to-aad.py which
 *     re-points project references to the AAD team.
 */
export const PAYER_INITIATIVES_TEAM_ID = '39a012ac-753a-ed11-9db0-000d3a14acce';
export const PAYER_INITIATIVES_TEAM_NAMES = [
  'Payer Initiatives',
  'Coram Finance RevCycle - Payer Initiatives',
];
export const PAYER_INITIATIVES_DISPLAY = 'Payer Initiatives';

/**
 * Default program that Payer Initiatives PROJECT intakes are pre-filled to
 * on the intake wizard once the requester picks Payer Initiatives as Primary
 * Team. Resolved by NAME at runtime (not GUID) so it works across DEV/PROD
 * where the pmo_program row has different ids -- same env-agnostic approach
 * as PAYER_INITIATIVES_TEAM_NAMES. The requester can still override the
 * pre-filled selection. Keep in sync with the pmo_program.pmo_name in each
 * environment ('Payer Initiative Program', PROG-1011 in PROD).
 */
export const PAYER_INITIATIVES_PROGRAM_NAMES = [
  'Payer Initiative Program',
  'Payer Initiatives Program',
];

export const HPI_LIST_PATH = '/hpi';
export const HPI_DETAIL_PATH = '/hpi/:id';

export function hpiDetailHref(id: string): string {
  return `/hpi/${id}`;
}

export const PAYER_ISSUES_LIST_PATH = '/payer-issues';
export const PAYER_ISSUES_DETAIL_PATH = '/payer-issues/:id';

export function payerIssueDetailHref(id: string): string {
  return `/payer-issues/${id}`;
}
