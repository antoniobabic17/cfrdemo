/**
 * explain-program-health topic — Wave 1 advisory output.
 * Produces a ProgramHealthAdvisory using enriched program context
 * (record-level program + related project list). Advisory mode only.
 */

import type { ProgramContext } from '../context/programContext';
import type { ProgramHealthAdvisory, ProgramProjectRollup } from '../contracts';
import { programHealthSignals, resolveHealthLabel } from '../grounding/signals';

function buildProjectRollup(projects: ProgramContext['projects']): ProgramProjectRollup {
  let onTrack = 0;
  let atRisk = 0;
  let offTrack = 0;
  for (const p of projects) {
    const h = p.proj_overallhealth;
    if (h === 189330000) onTrack++;
    else if (h === 189330001) atRisk++;
    else if (h === 189330002) offTrack++;
  }
  return { total: projects.length, onTrack, atRisk, offTrack };
}

function buildAttentionItems(ctx: ProgramContext, rollup: ProgramProjectRollup): string[] {
  const items: string[] = [];
  const overall = resolveHealthLabel(ctx.program.proj_overallhealth);

  for (const source of ctx.sourceStatus.filter((s) => s.state === 'failed')) {
    items.push(`Some program signals are unavailable because ${source.source} failed to load.`);
  }

  if (overall === 'Off Track') {
    items.push('Program is Off Track — escalation and portfolio review recommended.');
  } else if (overall === 'At Risk') {
    items.push('Program is At Risk — assess cross-project dependencies and blockers.');
  }

  if (rollup.offTrack > 0) {
    items.push(`${rollup.offTrack} project(s) in this program are Off Track.`);
  }
  if (rollup.atRisk > 1) {
    items.push(`${rollup.atRisk} project(s) are At Risk.`);
  }

  const now = new Date();
  const overdueProjects = ctx.projects.filter(
    (p) => p.msdyn_finish && new Date(p.msdyn_finish) < now && p.statecode === 0,
  );
  if (overdueProjects.length > 0) {
    items.push(`${overdueProjects.length} project(s) are past their planned end date.`);
  }

  const staleProjects = ctx.projects.filter((p) => {
    if (!p.modifiedon) return false;
    const ageDays = (now.getTime() - new Date(p.modifiedon).getTime()) / (1000 * 60 * 60 * 24);
    return ageDays > 21;
  });
  if (staleProjects.length > 0) {
    items.push(`${staleProjects.length} project(s) have not been updated in over 21 days.`);
  }

  const staleStatus = ctx.statusFreshness.filter((f) => f.state === 'stale').length;
  const missingStatus = ctx.statusFreshness.filter((f) => f.state === 'missing').length;
  if (staleStatus > 0) {
    items.push(`${staleStatus} project(s) have stale status reports older than 14 days.`);
  }
  if (missingStatus > 0) {
    items.push(`${missingStatus} project(s) have no status report on file.`);
  }

  if (items.length === 0) {
    items.push('No critical issues detected. Program health appears on track.');
  }
  return items;
}

function buildSummary(ctx: ProgramContext, rollup: ProgramProjectRollup): string {
  const overall = resolveHealthLabel(ctx.program.proj_overallhealth);
  let text = `Program "${ctx.program.msdyn_name}" is ${overall} with ${rollup.total} active project(s).`;
  const parts: string[] = [];
  if (rollup.onTrack > 0) parts.push(`${rollup.onTrack} on track`);
  if (rollup.atRisk > 0) parts.push(`${rollup.atRisk} at risk`);
  if (rollup.offTrack > 0) parts.push(`${rollup.offTrack} off track`);
  if (parts.length > 0) text += ` (${parts.join(', ')}).`;

  const staleStatus = ctx.statusFreshness.filter((f) => f.state === 'stale').length;
  const missingStatus = ctx.statusFreshness.filter((f) => f.state === 'missing').length;
  if (staleStatus > 0 || missingStatus > 0) {
    text += ` Status freshness: ${staleStatus} stale, ${missingStatus} missing.`;
  }
  return text;
}

export function explainProgramHealth(ctx: ProgramContext): ProgramHealthAdvisory {
  const rollup = buildProjectRollup(ctx.projects);
  const signals = programHealthSignals(ctx.program, rollup);
  const overall = resolveHealthLabel(ctx.program.proj_overallhealth);
  const failedSources = ctx.sourceStatus.filter((s) => s.state === 'failed').length;
  const missingSources = ctx.sourceStatus.filter((s) => s.state === 'missing').length;
  const confidence = failedSources > 0 ? 'low' : missingSources > 1 ? 'medium' : 'high';

  return {
    topicId: 'explain-program-health',
    mode: 'advisory',
    programId: ctx.program.msdyn_projectprogramid,
    programName: ctx.program.msdyn_name,
    overallHealth: overall,
    healthSignals: signals,
    projectRollup: rollup,
    summary: buildSummary(ctx, rollup),
    attentionItems: buildAttentionItems(ctx, rollup),
    sourceStatus: ctx.sourceStatus,
    confidence,
    generatedAt: new Date().toISOString(),
  };
}
