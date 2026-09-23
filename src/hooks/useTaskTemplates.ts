/**
 * useTaskTemplates — list + mutate reusable task-list templates, with the same
 * personal/team sharing model as saved table views.
 *
 * Returns templates grouped for the Apply Template dialog:
 *   - predefined : system defaults (migrated built-ins)
 *   - mine       : the current user's personal templates
 *   - team       : team-scoped templates for the user's teams
 * plus create/update/delete mutations.
 *
 * FALLBACK (net-neutral): if the pmo_tasktemplate table is empty or unreachable
 * (e.g. before the seed script runs, or an older env), `predefined` falls back
 * to the in-code PROJECT_TEMPLATES so Apply Template never breaks.
 */
import { useMemo } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useCurrentUserId } from './useCurrentUserId';
import { useCurrentUserTeams } from './useCurrentUserTeams';
import {
  listTaskTemplates, createTaskTemplate, updateTaskTemplate, deleteTaskTemplate,
} from '../api/taskTemplates.api';
import type { TaskTemplate, TaskTemplateCreate } from '../models/taskTemplate.model';
import { parseTaskPayload } from '../models/taskTemplate.model';
import { PROJECT_TEMPLATES, CFR_CATEGORY_LABELS, type TemplateTask } from '../lib/projectTemplates';

const QK = ['taskTemplates'] as const;

export interface ResolvedTemplate {
  id: string;               // row id, or `predefined:<category>` for the in-code fallback
  name: string;
  tasks: TemplateTask[];
  scope: 'system' | 'personal' | 'team';
  teamId?: string | null;
  teamName?: string;
  isFallback: boolean;      // true = in-code fallback, not a real row (not editable)
}

/** In-code predefined templates as ResolvedTemplate[] — the safety fallback. */
function fallbackPredefined(): ResolvedTemplate[] {
  return Object.entries(PROJECT_TEMPLATES).map(([cat, tasks]) => ({
    id: `predefined:${cat}`,
    name: CFR_CATEGORY_LABELS[Number(cat)] ?? cat,
    tasks: tasks ?? [],
    scope: 'system',
    isFallback: true,
  }));
}

function toResolved(t: TaskTemplate): ResolvedTemplate {
  const scope: ResolvedTemplate['scope'] = t.pmo_issystemdefault
    ? 'system'
    : t.pmo_scope === 'team' ? 'team' : 'personal';
  return {
    id: t.pmo_tasktemplateid,
    name: t.pmo_name,
    tasks: parseTaskPayload(t.pmo_taskpayload),
    scope,
    teamId: t['_pmo_team_value'] ?? null,
    teamName: t['_pmo_team_value@OData.Community.Display.V1.FormattedValue'],
    isFallback: false,
  };
}

export function useTaskTemplates() {
  const qc = useQueryClient();
  const userId = useCurrentUserId();
  const teamSet = useCurrentUserTeams();
  const teamIds = useMemo(() => (teamSet ? [...teamSet] : []), [teamSet]);
  const teamKey = teamIds.join(',');

  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: [...QK, userId ?? null, teamKey],
    enabled: !!userId,
    queryFn: () => listTaskTemplates(userId as string, teamIds),
    staleTime: 5 * 60 * 1000,
  });

  const resolved = useMemo(() => rows.map(toResolved), [rows]);

  // Predefined: prefer seeded system rows; fall back to in-code templates when none.
  const systemRows = resolved.filter((r) => r.scope === 'system');
  const predefined = (systemRows.length > 0 || (!isError && isLoading === false && rows.length > 0))
    ? systemRows
    : fallbackPredefined();

  const mine = resolved.filter((r) => r.scope === 'personal');
  const team = resolved.filter((r) => r.scope === 'team');

  const invalidate = () => qc.invalidateQueries({ queryKey: QK });

  const create = useMutation({
    mutationFn: (payload: TaskTemplateCreate) => createTaskTemplate(payload),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: (args: { id: string; name: string; payload: string; scope?: string; teamId?: string | null }) =>
      updateTaskTemplate(args.id, args.name, args.payload, args.scope, args.teamId),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteTaskTemplate(id),
    onSuccess: invalidate,
  });

  return { predefined, mine, team, isLoading, isError, userId, teamIds, create, update, remove };
}
