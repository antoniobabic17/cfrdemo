/**
 * pmo-triage-needs-attention topic — Wave 1 advisory output.
 * Produces a ranked TriageSummary grounded on PMO health, overdue, stale, and blocker signals.
 * Advisory only, no write-intent or execution behavior.
 */

import type { TriageContext } from '../context/triageContext';
import type { TriageSummary, TriageAttentionItem } from '../contracts';

function lastStatusByProject(ctx: TriageContext): Map<string, Date> {
  const map = new Map<string, Date>();
  for (const report of ctx.latestStatusReports) {
    const projectId = report._msdyn_project_value;
    if (!projectId) continue;
    const raw = report.proj_reportingdate ?? report.createdon;
    if (!raw) continue;
    const date = new Date(raw);
    if (!map.has(projectId)) map.set(projectId, date);
  }
  return map;
}

function scoreProject(
  project: TriageContext['projects'][number],
  now: Date,
  lastStatus: Date | undefined,
): { score: number; reasons: string[]; nextStep: string } {
  let score = 0;
  const reasons: string[] = [];

  if (project.proj_overallhealth === 189330002) {
    score += 5;
    reasons.push('Project health is Off Track.');
  } else if (project.proj_overallhealth === 189330001) {
    score += 3;
    reasons.push('Project health is At Risk.');
  }

  const due = project.msdyn_finish ? new Date(project.msdyn_finish) : undefined;
  if (due && due.getTime() < now.getTime()) {
    score += 2;
    reasons.push('Target finish date has passed while project remains active.');
  }

  const activeRisks = project.proj_activerisks ?? 0;
  const activeIssues = project.proj_activeissues ?? 0;
  if (activeRisks + activeIssues >= 6) {
    score += 3;
    reasons.push(`High open risk/issue load (${activeRisks + activeIssues}).`);
  } else if (activeRisks + activeIssues >= 3) {
    score += 2;
    reasons.push(`Elevated open risk/issue load (${activeRisks + activeIssues}).`);
  }

  if (!lastStatus) {
    score += 2;
    reasons.push('No status report found for this project.');
  } else {
    const ageDays = Math.max(0, Math.floor((now.getTime() - lastStatus.getTime()) / (1000 * 60 * 60 * 24)));
    if (ageDays > 14) {
      score += 2;
      reasons.push(`Latest status report is stale (${ageDays} days old).`);
    }
  }

  const nextStep =
    project.proj_overallhealth === 189330002
      ? 'Run PMO escalation review and lock corrective actions with owners.'
      : activeRisks + activeIssues >= 3
        ? 'Review top risks/issues and assign dated mitigation owners.'
        : 'Request an updated status report and confirm near-term milestone plan.';

  return { score, reasons, nextStep };
}

export function pmoTriageNeedsAttention(ctx: TriageContext): TriageSummary {
  const now = new Date();
  const statusMap = lastStatusByProject(ctx);

  const ranked = ctx.projects
    .map((project) => {
      const lastStatus = statusMap.get(project.msdyn_projectid);
      const { score, reasons, nextStep } = scoreProject(project, now, lastStatus);
      return {
        project,
        score,
        reasons,
        nextStep,
      };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const items: TriageAttentionItem[] = ranked.map((row, index) => ({
    rank: index + 1,
    scope: 'project',
    entityId: row.project.msdyn_projectid,
    title: row.project.msdyn_subject,
    whyNow: row.reasons.join(' '),
    recommendedNextStep: row.nextStep,
    severity: row.score >= 7 ? 'high' : row.score >= 4 ? 'medium' : 'low',
  }));

  const failedSources = ctx.sourceStatus.filter((s) => s.state === 'failed').length;
  const missingSources = ctx.sourceStatus.filter((s) => s.state === 'missing').length;

  const summary =
    items.length === 0
      ? 'No urgent attention items detected from currently available PMO signals.'
      : `Top ${items.length} attention item(s) ranked by current delivery health, status freshness, and overdue exposure.`;

  return {
    topicId: 'pmo-triage-needs-attention',
    mode: 'advisory',
    scope: ctx.scope,
    summary,
    rankedAttentionItems: items,
    sourceStatus: ctx.sourceStatus,
    confidence: failedSources > 0 ? 'low' : missingSources > 1 ? 'medium' : 'high',
    generatedAt: new Date().toISOString(),
  };
}
