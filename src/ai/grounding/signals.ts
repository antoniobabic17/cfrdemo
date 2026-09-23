/**
 * Mira grounding — deterministic PMO health signal builders.
 * Converts raw Dataverse field values into typed HealthSignal arrays
 * and health label strings used by Wave 1 topic functions.
 */

import type { Project } from '../../models/project.model';
import type { Program } from '../../models/program.model';
import type { ProjectRisk } from '../../models/projectRisk.model';
import type { ProjectIssue } from '../../models/projectIssue.model';
import type { HealthSignal, HealthLabel, SignalStatus, ProgramProjectRollup } from '../contracts';

/** Normalize msdyn_progress (stored 0-1 in Dataverse) to a 0-100 integer. */
function normPct(raw: number | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  return raw > 0 && raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
}

/** Maps PMO Accelerator option-set codes to display labels. */
const HEALTH_CODE_MAP: Record<number, HealthLabel> = {
  189330000: 'On Track',
  189330001: 'At Risk',
  189330002: 'Off Track',
};

export function resolveHealthLabel(code: number | undefined | null): HealthLabel {
  if (code == null) return 'Unknown';
  return HEALTH_CODE_MAP[code] ?? 'Unknown';
}

export function resolveHealthStatus(health: HealthLabel): SignalStatus {
  if (health === 'On Track') return 'ok';
  if (health === 'At Risk') return 'warn';
  if (health === 'Off Track') return 'critical';
  return 'warn';
}

/** Deterministic health signal array for a project context. */
export function projectHealthSignals(
  project: Project,
  risks: ProjectRisk[],
  issues: ProjectIssue[],
  thresholds?: { riskCountWarn: number; riskCountCritical: number },
): HealthSignal[] {
  const riskCountCritical = thresholds?.riskCountCritical ?? 4;
  const signals: HealthSignal[] = [];

  const overall = resolveHealthLabel(project.proj_overallhealth);
  signals.push({ dimension: 'Overall Health', value: overall, status: resolveHealthStatus(overall) });

  const schedule = resolveHealthLabel(project.proj_schedulehealth);
  signals.push({ dimension: 'Schedule Health', value: schedule, status: resolveHealthStatus(schedule) });

  const effort = resolveHealthLabel(project.proj_efforthealth);
  signals.push({ dimension: 'Effort Health', value: effort, status: resolveHealthStatus(effort) });

  const financial = resolveHealthLabel(project.proj_financialhealth);
  signals.push({ dimension: 'Financial Health', value: financial, status: resolveHealthStatus(financial) });

  const progress = normPct(project.msdyn_progress);
  signals.push({
    dimension: 'Progress',
    value: `${progress}%`,
    status: 'ok',
  });

  const activeRisks = risks.filter((r) => r.statecode === 0).length;
  signals.push({
    dimension: 'Active Risks',
    value: String(activeRisks),
    status: activeRisks === 0 ? 'ok' : activeRisks > riskCountCritical ? 'critical' : 'warn',
  });

  const activeIssues = issues.filter((i) => i.statecode === 0).length;
  signals.push({
    dimension: 'Active Issues',
    value: String(activeIssues),
    status: activeIssues === 0 ? 'ok' : activeIssues > riskCountCritical ? 'critical' : 'warn',
  });

  return signals;
}

/** Deterministic health signal array for a program context. */
export function programHealthSignals(
  program: Program,
  rollup: ProgramProjectRollup,
): HealthSignal[] {
  const signals: HealthSignal[] = [];

  const overall = resolveHealthLabel(program.proj_overallhealth);
  signals.push({ dimension: 'Overall Health', value: overall, status: resolveHealthStatus(overall) });

  const schedule = resolveHealthLabel(program.proj_schedulehealth);
  signals.push({ dimension: 'Schedule Health', value: schedule, status: resolveHealthStatus(schedule) });

  const financial = resolveHealthLabel(program.proj_financialhealth);
  signals.push({ dimension: 'Financial Health', value: financial, status: resolveHealthStatus(financial) });

  signals.push({
    dimension: 'Active Projects',
    value: String(rollup.total),
    status: 'ok',
  });

  signals.push({
    dimension: 'At Risk / Off Track',
    value: `${rollup.atRisk} at risk, ${rollup.offTrack} off track`,
    status: rollup.offTrack > 0 ? 'critical' : rollup.atRisk > 0 ? 'warn' : 'ok',
  });

  return signals;
}
