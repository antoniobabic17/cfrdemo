/**
 * Option-set label maps for the custom Monitor twins (Tier 2 decoupling).
 *
 * pmo_projectrisk / pmo_projectissue / pmo_projectchange copy their option-set
 * VALUES 1:1 from the native msdyn_* entities (base 189330000, verified live
 * 2026-08-13). Dataverse returns the label only via the
 * `@OData.Community.Display.V1.FormattedValue` annotation, which our custom
 * $select does NOT request (annotations add cost + the labels are static). The
 * custom-source normalizers synthesize that annotation from these maps so the
 * MonitorWorkspace UI renders identical text in custom mode as in pss mode.
 *
 * Keep in lockstep with scripts/create-pmo-monitor-tables.py.
 */

export const STATE_LABELS: Record<number, string> = {
  189330000: '(1) Proposed',
  189330001: '(2) Active',
  189330002: '(3) Closed',
  189330003: '(4) On Hold',
};

export const PRIORITY_LABELS: Record<number, string> = {
  189330000: '(1) Critical',
  189330001: '(2) High',
  189330002: '(3) Moderate',
  189330003: '(4) Low',
};

export const RISK_CATEGORY_LABELS: Record<number, string> = {
  189330000: 'Stakeholder',
  189330001: 'Scope',
  189330002: 'Change',
  189330003: 'Resources',
  189330004: 'Design',
  189330005: 'Technical',
  189330006: 'Other',
};

export const ISSUE_CATEGORY_LABELS: Record<number, string> = {
  189330000: 'Issue',
  189330001: 'Task',
  189330002: 'Bug',
  189330003: 'Other',
};

export const CHANGE_TYPE_LABELS: Record<number, string> = {
  189330000: 'Scope',
  189330001: 'Schedule',
  189330002: 'Cost',
  189330003: 'None',
};

export const CHANGE_IMPACT_LABELS: Record<number, string> = {
  189330000: '(1) High',
  189330001: '(2) Medium',
  189330002: '(3) Low',
};

export const CHANGE_RISK_LABELS: Record<number, string> = {
  189330000: '(1) High',
  189330001: '(2) Moderate',
  189330002: '(3) Low',
  189330003: '(4) None',
};

export const CHANGE_APPROVAL_LABELS: Record<number, string> = {
  189330000: '(1) Not Yet Requested',
  189330001: '(2) Requested',
  189330002: '(3) Approved',
  189330003: '(4) Rejected',
};

/** Return the label for a value, or undefined when the value is null/unset. */
export function labelFor(
  map: Record<number, string>,
  value: number | null | undefined,
): string | undefined {
  return value == null ? undefined : map[value];
}
