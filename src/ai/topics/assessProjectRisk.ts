/**
 * assess-project-risk topic - Wave 2 advisory output.
 * Produces a deterministic risk assessment from project context.
 */

import type { ProjectContext } from '../context/projectContext';
import type { ProjectRiskAssessmentAdvisory } from '../contracts';

function calcRiskScore(ctx: ProjectContext): number {
  let score = 0;
  if (ctx.project.proj_overallhealth === 189330002) score += 5;
  if (ctx.project.proj_overallhealth === 189330001) score += 3;
  score += Math.min(ctx.risks.filter((r) => r.statecode === 0).length, 5);
  score += Math.min(ctx.issues.filter((i) => i.statecode === 0).length, 4);
  return Math.min(score, 15);
}

export function assessProjectRisk(ctx: ProjectContext): ProjectRiskAssessmentAdvisory {
  const activeRisks = ctx.risks.filter((r) => r.statecode === 0);
  const openIssues = ctx.issues.filter((i) => i.statecode === 0);

  const topRisks = [
    `${activeRisks.length} active risk(s) require mitigation tracking.`,
    `${openIssues.length} open issue(s) may degrade delivery confidence.`,
  ];

  if (ctx.project.proj_schedulehealth === 189330001 || ctx.project.proj_schedulehealth === 189330002) {
    topRisks.push('Schedule health signal indicates elevated timeline risk.');
  }

  const mitigationRecommendations = [
    'Prioritize top risks by impact and assign dated mitigation owners.',
    'Review open issues in weekly PMO checkpoint and close stale blockers.',
    'Align schedule recovery actions with near-term milestone commitments.',
  ];

  return {
    topicId: 'assess-project-risk',
    mode: 'advisory',
    projectId: ctx.project.msdyn_projectid,
    projectName: ctx.project.msdyn_subject,
    riskScore: calcRiskScore(ctx),
    topRisks,
    mitigationRecommendations,
    sourceStatus: ctx.sourceStatus,
    confidence: ctx.sourceStatus.some((s) => s.state === 'failed') ? 'low' : 'high',
    generatedAt: new Date().toISOString(),
  };
}
