/**
 * explain-project-health topic — Wave 1 advisory output.
 * Produces a ProjectHealthAdvisory from deterministic signal analysis.
 * No mutation payloads. Advisory mode only.
 */

import type { ProjectContext } from '../context/projectContext';
import type { ProjectHealthAdvisory, HealthSignal } from '../contracts';
import { projectHealthSignals, resolveHealthLabel } from '../grounding/signals';

/** Normalize msdyn_progress (stored 0-1 in Dataverse) to a 0-100 integer. */
function normPct(raw: number | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  return raw > 0 && raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
}

function buildAttentionItems(ctx: ProjectContext): string[] {
  const items: string[] = [];
  const { project, risks, issues } = ctx;

  for (const source of ctx.sourceStatus.filter((s) => s.state === 'failed')) {
    items.push(`Some signals are unavailable because ${source.source} failed to load.`);
  }

  const overall = resolveHealthLabel(project.proj_overallhealth);
  if (overall === 'Off Track') {
    items.push('Project is Off Track — immediate review and corrective action recommended.');
  } else if (overall === 'At Risk') {
    items.push('Project is At Risk — monitor blockers and escalate if unresolved within the week.');
  }

  const activeRisks = risks.filter((r) => r.statecode === 0);
  const highRisks = activeRisks.filter(
    (r) => (r.proj_exposure ?? 0) >= 4 || (r.proj_impact ?? 0) >= 4,
  );
  if (highRisks.length > 0) {
    items.push(`${highRisks.length} high-exposure risk(s) require active mitigation.`);
  } else if (activeRisks.length > 2) {
    items.push(`${activeRisks.length} open risks are active — review and prioritize.`);
  }

  const openIssues = issues.filter((i) => i.statecode === 0);
  const overdueIssues = openIssues.filter(
    (i) => i.proj_duedate && new Date(i.proj_duedate) < new Date(),
  );
  if (overdueIssues.length > 0) {
    items.push(`${overdueIssues.length} issue(s) are past their due date.`);
  }

  const progress = normPct(project.msdyn_progress);
  const start = project.msdyn_scheduledstart ? new Date(project.msdyn_scheduledstart) : null;
  const end = project.msdyn_finish ? new Date(project.msdyn_finish) : null;
  if (start && end) {
    const totalMs = end.getTime() - start.getTime();
    const elapsedMs = Date.now() - start.getTime();
    const timeElapsedPct =
      totalMs > 0 ? Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100)) : 0;
    const lag = timeElapsedPct - progress;
    if (lag > 20) {
      items.push(
        `Schedule lag of ~${Math.round(lag)}% detected — project is behind expected progress.`,
      );
    }
  }

  if (items.length === 0) {
    items.push('No critical signals detected. Project appears on track.');
  }
  return items;
}

function buildSummary(ctx: ProjectContext, signals: HealthSignal[]): string {
  const { project } = ctx;
  const overall = resolveHealthLabel(project.proj_overallhealth);
  const progress = normPct(project.msdyn_progress);
  const activeRisks = ctx.risks.filter((r) => r.statecode === 0).length;
  const activeIssues = ctx.issues.filter((i) => i.statecode === 0).length;
  const criticals = signals.filter((s) => s.status === 'critical').length;
  const warns = signals.filter((s) => s.status === 'warn').length;

  let text = `${project.msdyn_subject} is ${overall} at ${progress}% completion.`;
  if (criticals > 0) {
    text += ` ${criticals} critical signal(s) require immediate attention.`;
  } else if (warns > 0) {
    text += ` ${warns} advisory signal(s) to monitor.`;
  } else {
    text += ' All health dimensions look normal.';
  }
  if (activeRisks > 0 || activeIssues > 0) {
    text += ` ${activeRisks} open risk(s) and ${activeIssues} open issue(s).`;
  }
  return text;
}

export function explainProjectHealth(ctx: ProjectContext): ProjectHealthAdvisory {
  const signals = projectHealthSignals(ctx.project, ctx.risks, ctx.issues);
  const overall = resolveHealthLabel(ctx.project.proj_overallhealth);
  const criticals = signals.filter((s) => s.status === 'critical').length;
  const failedSources = ctx.sourceStatus.filter((s) => s.state === 'failed').length;
  const missingSources = ctx.sourceStatus.filter((s) => s.state === 'missing').length;

  const confidence =
    failedSources > 0 ? 'low' : missingSources > 1 ? 'medium' : criticals > 0 ? 'high' : 'medium';

  return {
    topicId: 'explain-project-health',
    mode: 'advisory',
    projectId: ctx.project.msdyn_projectid,
    projectName: ctx.project.msdyn_subject,
    overallHealth: overall,
    healthSignals: signals,
    summary: buildSummary(ctx, signals),
    attentionItems: buildAttentionItems(ctx),
    sourceStatus: ctx.sourceStatus,
    confidence,
    generatedAt: new Date().toISOString(),
  };
}
