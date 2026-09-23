/**
 * Systems Improvement — team identity.
 *
 * Unlike Payer Initiatives / BI / Process & Project, Systems Improvement is NOT a
 * routed team feature pack — it has no custom routes or slots. It exists here only
 * to gate the UAT sidebar area: UAT is visible only to Systems Improvement members
 * (and admins acting-as Systems Improvement via the act-as pill).
 *
 * SYSTEMS_IMPROVEMENT_TEAM_ID is the Systems Improvement Owner team GUID recorded in
 * docs/security-model.md. The operator confirmed a "Systems Improvement" team is
 * already visible in the sidebar Teams section on BOTH dev and prod; this GUID plus
 * the name variants below match it. Name matching (case-insensitive, exact against
 * the team's `name`) is the env-portable fallback, mirroring the other packs'
 * *_TEAM_NAMES arrays for AAD-synced teams whose GUID differs per environment.
 */
export const SYSTEMS_IMPROVEMENT_TEAM_ID = 'd70f5e7f-d589-ec11-93b0-00224831189c';

export const SYSTEMS_IMPROVEMENT_TEAM_NAMES = [
  'Systems Improvement',
  'Coram Finance RevCycle - Systems Improvement',
];

export const SYSTEMS_IMPROVEMENT_DISPLAY = 'Systems Improvement';
