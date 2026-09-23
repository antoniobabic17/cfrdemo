/**
 * pmo_tasktemplate — a reusable task-list ("WBS") template applied from the
 * tasks board. Modeled on pmo_userview: it carries a scope (personal | team)
 * plus user + team lookups so a user can keep a template private or share it
 * with their team, exactly like the saved-views system.
 *
 * Distinct from `pmo_projecttemplate` (admin-managed onboarding WBS by category).
 * Predefined templates are seeded here with pmo_issystemdefault = true.
 */
import type { TemplateTask } from '../lib/projectTemplates';

export interface TaskTemplate {
  pmo_tasktemplateid: string;
  /** Display name shown in the Apply Template dialog. */
  pmo_name: string;
  /** JSON: TemplateTask[] — see pmo_taskpayload helpers below. */
  pmo_taskpayload?: string | null;
  /** 'personal' (owner only) | 'team' (everyone on pmo_team). Absent = personal. */
  pmo_scope?: string | null;
  /** True for the migrated predefined templates (visible to everyone). */
  pmo_issystemdefault?: boolean;
  /** Optional CFR_CATEGORY value for predefined templates (grouping/labels). */
  pmo_category?: number | null;
  '_pmo_user_value'?: string;
  '_pmo_team_value'?: string | null;
  '_pmo_team_value@OData.Community.Display.V1.FormattedValue'?: string;
  statecode?: 0 | 1;
  createdon?: string;
}

export interface TaskTemplateCreate {
  pmo_name: string;
  pmo_taskpayload: string;
  pmo_scope: string;
  pmo_issystemdefault?: boolean;
  pmo_category?: number;
  'pmo_User@odata.bind'?: string;
  'pmo_Team@odata.bind'?: string;
}

export type TemplateScope = 'personal' | 'team';

/** Parse pmo_taskpayload into a TemplateTask[]. Forgiving — never throws. */
export function parseTaskPayload(value: string | null | undefined): TemplateTask[] {
  if (!value) return [];
  try {
    const raw = JSON.parse(value);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((t): t is { subject?: unknown; isMilestone?: unknown; duration?: unknown } => !!t && typeof t === 'object')
      .map((t) => ({
        subject: typeof t.subject === 'string' ? t.subject : '',
        isMilestone: t.isMilestone === true,
        duration: typeof t.duration === 'number' ? t.duration : undefined,
      }))
      .filter((t) => t.subject.trim() !== '');
  } catch {
    return [];
  }
}

/** Serialize a TemplateTask[] for storage in pmo_taskpayload. */
export function serializeTaskPayload(tasks: TemplateTask[]): string {
  return JSON.stringify(
    tasks
      .filter((t) => t.subject.trim() !== '')
      .map((t) => ({
        subject: t.subject.trim(),
        ...(t.isMilestone ? { isMilestone: true } : {}),
        ...(typeof t.duration === 'number' ? { duration: t.duration } : {}),
      })),
  );
}
