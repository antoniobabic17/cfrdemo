/**
 * Project template resolution.
 *
 * Centralizes the precedence rules used to pick a project template + task list
 * when a project is being created. Both the manual ProjectOnboardingWizard and
 * the auto-conversion flow (StageApprovalPanel on final approval) depend on the
 * same logic; keeping it here means the two stay in sync.
 *
 * Precedence:
 *   1. selectedTemplateId       — user explicitly picked one
 *   2. team default             — pmo_appsetting key TEAM_DEFAULT_TEMPLATE_<teamId>
 *   3. system default           — pmo_appsetting key DEFAULT_PROJECT_TEMPLATE
 *   4. CFR category fallback    — hard-coded PROJECT_TEMPLATES[category] from
 *                                 lib/projectTemplates.ts
 *   5. nothing                  — empty task list, no template
 */

import type { AppSetting } from '../api/appSettings.api';
import type { ProjectTemplate } from '../models/projectTemplate.model';
import {
  SETTING_DEFAULT_PROJECT_TEMPLATE,
  SETTING_TEAM_DEFAULT_TEMPLATE_PREFIX,
} from './constants';
import { PROJECT_TEMPLATES, type TemplateTask } from './projectTemplates';

export type TemplateSource =
  | 'User selected'
  | 'Team default'
  | 'System default'
  | 'Category fallback'
  | 'None';

export interface TemplateResolutionInput {
  /** Settings keyed by pmo_key. Use Object.fromEntries(settings.map(s => [s.pmo_key, s])). */
  settingMap: Record<string, AppSetting | undefined>;
  /** All available project templates (from useProjectTemplates). */
  templates: ProjectTemplate[];
  /** Optional explicit user pick. Highest precedence. */
  selectedTemplateId?: string;
  /** Primary team for the project — drives team-default lookup. */
  primaryTeamId?: string;
  /** CFR category — drives the hard-coded fallback. */
  cfrCategory?: number;
}

export interface TemplateResolutionResult {
  /** The pmo_projecttemplate row that was selected (undefined if falling back to category). */
  template?: ProjectTemplate;
  /** The pmo_projecttemplateid string to persist on the project (empty string if none). */
  templateId: string;
  /** Tasks to seed the project schedule with. Empty list = no template applied. */
  tasks: TemplateTask[];
  /** Human-readable label describing which precedence step won. */
  source: TemplateSource;
}

export function resolveTemplate(input: TemplateResolutionInput): TemplateResolutionResult {
  const { settingMap, templates, selectedTemplateId, primaryTeamId, cfrCategory } = input;

  // Step 1: explicit user pick
  if (selectedTemplateId) {
    const t = templates.find((tpl) => tpl.pmo_projecttemplateid === selectedTemplateId);
    return {
      template: t,
      templateId: selectedTemplateId,
      tasks: parseTasks(t),
      source: 'User selected',
    };
  }

  // Step 2: team default
  if (primaryTeamId) {
    const teamDefaultId = settingMap[`${SETTING_TEAM_DEFAULT_TEMPLATE_PREFIX}${primaryTeamId}`]?.pmo_value;
    if (teamDefaultId) {
      const t = templates.find((tpl) => tpl.pmo_projecttemplateid === teamDefaultId);
      return {
        template: t,
        templateId: teamDefaultId,
        tasks: parseTasks(t),
        source: 'Team default',
      };
    }
  }

  // Step 3: system default
  const systemDefaultId = settingMap[SETTING_DEFAULT_PROJECT_TEMPLATE]?.pmo_value;
  if (systemDefaultId) {
    const t = templates.find((tpl) => tpl.pmo_projecttemplateid === systemDefaultId);
    return {
      template: t,
      templateId: systemDefaultId,
      tasks: parseTasks(t),
      source: 'System default',
    };
  }

  // Step 4: CFR category fallback (no template row, just hard-coded tasks)
  if (cfrCategory != null) {
    const tasks = PROJECT_TEMPLATES[cfrCategory] ?? [];
    if (tasks.length > 0) {
      return { templateId: '', tasks, source: 'Category fallback' };
    }
  }

  // Step 5: nothing
  return { templateId: '', tasks: [], source: 'None' };
}

function parseTasks(template: ProjectTemplate | undefined): TemplateTask[] {
  if (!template) return [];
  try {
    const parsed = JSON.parse(template.pmo_taskpayload);
    return Array.isArray(parsed) ? (parsed as TemplateTask[]) : [];
  } catch {
    return [];
  }
}
