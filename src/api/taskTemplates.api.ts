import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import type { TaskTemplate, TaskTemplateCreate } from '../models/taskTemplate.model';

const SET = ENTITY_SETS.taskTemplate;
const FIELDS: (keyof TaskTemplate)[] = [
  'pmo_tasktemplateid', 'pmo_name', 'pmo_taskpayload', 'pmo_scope',
  'pmo_issystemdefault', 'pmo_category', '_pmo_user_value', '_pmo_team_value',
  'statecode', 'createdon',
];

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const bareGuid = (v: string): string => v.replace(/[{}]/g, '').trim().toLowerCase();

/**
 * Templates visible to the current user:
 *   - system defaults (pmo_issystemdefault = true) — the migrated predefined set,
 *   - everything they own (personal + their own team templates),
 *   - team-scoped templates for any team they belong to.
 * Mirrors listUserViews. Guards the pre-resolution `anonymous` user id.
 */
export async function listTaskTemplates(userId: string, teamIds: string[] = []): Promise<TaskTemplate[]> {
  const id = bareGuid(userId ?? '');
  const clauses: string[] = ['pmo_issystemdefault eq true'];
  if (GUID_RE.test(id)) clauses.push(`_pmo_user_value eq ${id}`);
  const validTeams = teamIds.map(bareGuid).filter((t) => GUID_RE.test(t));
  if (validTeams.length) {
    const teamOr = validTeams.map((t) => `_pmo_team_value eq ${t}`).join(' or ');
    clauses.push(`(pmo_scope eq 'team' and (${teamOr}))`);
  }
  return dv.list<TaskTemplate>(SET, {
    $select: FIELDS,
    $filter: `(${clauses.join(' or ')}) and statecode eq 0`,
    $orderby: 'pmo_name asc',
    $top: 400,
  });
}

export async function createTaskTemplate(payload: TaskTemplateCreate): Promise<TaskTemplate> {
  return dv.create<TaskTemplate>(SET, payload);
}

/** Update name + payload (+ optional scope/team). team=null clears the lookup (switch to personal). */
export async function updateTaskTemplate(
  id: string,
  name: string,
  taskPayload: string,
  scope?: string,
  teamId?: string | null,
): Promise<void> {
  const payload: Record<string, unknown> = { pmo_name: name, pmo_taskpayload: taskPayload };
  if (scope !== undefined) payload.pmo_scope = scope;
  if (teamId !== undefined) {
    payload['pmo_Team@odata.bind'] = teamId ? `/teams(${teamId.replace(/[{}]/g, '')})` : null;
  }
  return dv.update(SET, id, payload);
}

export async function deleteTaskTemplate(id: string): Promise<void> {
  return dv.remove(SET, id);
}
