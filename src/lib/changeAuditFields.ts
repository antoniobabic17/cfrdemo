/**
 * User-facing labels for entity fields shown in the change history feed.
 *
 * The activity row reads "modified <label>" — these are the strings the
 * end user sees, so they must read like English (not Dataverse column names).
 * Wave 1 covers project, program, task. Add new fields as needed.
 */

import type { ChangeAuditEntry, ChangeAuditFieldDiff } from '../hooks/useChangeAudit';

export const PROJECT_FIELD_LABELS: Record<string, string> = {
  msdyn_subject: 'Name',
  msdyn_description: 'Description',
  msdyn_businesscase: 'Business case',
  msdyn_valuestatement: 'Value statement',
  msdyn_comments: 'Comments',
  msdyn_scheduledstart: 'Start date',
  proj_budget: 'Budget',
  proj_forecast: 'Forecast',
  proj_benefits: 'Benefits',
  proj_fundingavailable: 'Funding available',
  pmo_cfrcategory: 'CFR category',
  pmo_complexity: 'Complexity',
  pmo_strategicpriority: 'Strategic priority',
  proj_overallhealth: 'Overall health',
  proj_schedulehealth: 'Schedule health',
  proj_efforthealth: 'Effort health',
  proj_financialhealth: 'Financial health',
  proj_issuehealth: 'Issue health',
  // Lookups (canonical OData bind keys are stripped to the column name below).
  msdyn_projectmanager: 'Project manager',
  proj_executivesponsor: 'Executive sponsor',
  proj_manager: 'Manager',
  msdyn_program: 'Program',
  pmo_primaryteam: 'Primary team',
};

export const PROGRAM_FIELD_LABELS: Record<string, string> = {
  msdyn_name: 'Name',
  msdyn_description: 'Description',
  // Add additional program columns as the program edit form gains them.
};

export const RISK_FIELD_LABELS: Record<string, string> = {
  msdyn_subject: 'Name',
  msdyn_name: 'Name',
  msdyn_description: 'Description',
  msdyn_mitigationplan: 'Mitigation plan',
  msdyn_contingencyplan: 'Contingency plan',
  proj_category: 'Category',
  proj_state: 'State',
  proj_impact: 'Impact',
  proj_probability: 'Probability',
  proj_exposure: 'Exposure',
  proj_due: 'Due date',
  proj_assignedto: 'Assigned to',
};

export const ISSUE_FIELD_LABELS: Record<string, string> = {
  msdyn_name: 'Name',
  msdyn_description: 'Description',
  msdyn_resolution: 'Resolution',
  proj_issuecategory: 'Category',
  proj_priority: 'Priority',
  proj_state: 'State',
  proj_duedate: 'Due date',
  proj_assignedto: 'Assigned to',
};

export const CHANGE_FIELD_LABELS: Record<string, string> = {
  msdyn_name: 'Name',
  msdyn_description: 'Description',
  msdyn_additionalcomments: 'Additional comments',
  proj_changetype: 'Type',
  proj_changeimpact: 'Impact',
  proj_changerisk: 'Risk',
  proj_priority: 'Priority',
  proj_approval: 'Approval',
  proj_state: 'State',
  proj_costimpact: 'Cost impact',
  proj_requesteddate: 'Requested date',
  proj_plannedstartdate: 'Planned start',
  proj_plannedduedate: 'Planned due',
  proj_changebenefits: 'Benefits',
  proj_changeplan: 'Change plan',
};

export const STATUS_REPORT_FIELD_LABELS: Record<string, string> = {
  msdyn_name: 'Name',
  msdyn_accomplishedactivities: 'Accomplished',
  msdyn_plannedactivities: 'Planned activities',
  msdyn_additionalcomments: 'Additional comments',
  proj_reportingdate: 'Reporting date',
  proj_overallhealth: 'Overall health',
  proj_schedulehealth: 'Schedule health',
  proj_efforthealth: 'Effort health',
  proj_financialhealth: 'Financial health',
  proj_issuehealth: 'Issue health',
};

export const TASK_FIELD_LABELS: Record<string, string> = {
  msdyn_subject: 'Name',
  msdyn_description: 'Description',
  msdyn_scheduledstart: 'Start date',
  msdyn_scheduledend: 'Due date',
  msdyn_duration: 'Duration',
  msdyn_effort: 'Effort hours',
  msdyn_effortcompleted: 'Hours done',
  msdyn_progress: 'Progress',
  msdyn_priority: 'Priority',
  msdyn_ismilestone: 'Milestone',
  msdyn_projectbucket: 'Bucket',
  msdyn_projectsprint: 'Sprint',
};

/**
 * Strip OData binding boilerplate so 'msdyn_projectmanager@odata.bind' becomes
 * the canonical lookup key 'msdyn_projectmanager' for the label table.
 */
export function normalizeFieldKey(rawKey: string): string {
  // 'msdyn_projectmanager@odata.bind' -> 'msdyn_projectmanager'
  // 'msdyn_subject' -> 'msdyn_subject'
  const noBind = rawKey.replace(/@odata\.bind$/i, '');
  return noBind.toLowerCase();
}

/** Default human label = title-cased Dataverse key, used when no entry in the map. */
function defaultLabel(key: string): string {
  return key
    .replace(/^msdyn_|^pmo_|^proj_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Compare a server-state record to a partial update payload and return one
 * ChangeAuditFieldDiff per actually-changed field. Fields that are absent
 * from the payload are skipped. Fields whose new value is structurally equal
 * to the old value are skipped (no-op edits).
 *
 * `labels` selects which label table to use (project / program / task / etc.).
 */
export function diffEntityUpdate(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: Record<string, string>,
): ChangeAuditFieldDiff[] {
  const out: ChangeAuditFieldDiff[] = [];
  for (const rawKey of Object.keys(after)) {
    const newVal = after[rawKey];
    if (newVal === undefined) continue;
    const key = normalizeFieldKey(rawKey);
    const oldVal = before[key] ?? before[rawKey];
    if (sameValue(oldVal, newVal)) continue;
    out.push({
      kind: 'field',
      field: key,
      label: labels[key] ?? defaultLabel(key),
      old: oldVal ?? null,
      new: newVal,
    });
  }
  return out;
}

/**
 * Convenience builder for a relationship-change entry. Lets call sites avoid
 * repeating the kind/action plumbing for every audit emission.
 */
export function relationshipEntry(
  relation: string,
  action: 'add' | 'remove' | 'update',
  label: string,
  extra?: { old?: unknown; new?: unknown },
): ChangeAuditEntry {
  return {
    kind: 'relationship',
    relation,
    action,
    label,
    ...(extra?.old !== undefined ? { old: extra.old } : {}),
    ...(extra?.new !== undefined ? { new: extra.new } : {}),
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  // Treat empty string and null/undefined as equivalent — saving an empty
  // input box shouldn't show as "modified" if the field was already empty.
  if ((a == null && b === '') || (b == null && a === '')) return true;
  return false;
}
