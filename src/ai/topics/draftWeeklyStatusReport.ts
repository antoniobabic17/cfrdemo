/**
 * draft-weekly-status-report topic — Wave 1 draft output.
 * Produces a StatusReportDraft from deterministic signals and prior status context.
 * Draft is editable. No mutation occurs; user must accept and save separately.
 */

import type { ProjectContext } from '../context/projectContext';
import type { StatusContext } from '../context/statusContext';
import type { StatusReportDraft } from '../contracts';

/** Normalize msdyn_progress (stored 0-1 in Dataverse) to a 0-100 integer. */
function normPct(raw: number | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  return raw > 0 && raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
}

function linesFromText(value: string | undefined, maxLines: number): string[] {
  if (!value) return [];
  return value
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, maxLines);
}

function currentReportingWeek(): string {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday
  const start = new Date(now);
  start.setDate(now.getDate() - dayOfWeek);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
}

function draftAccomplishedActivities(ctx: ProjectContext, statusCtx: StatusContext): string {
  const lines: string[] = [];

  const progress = normPct(ctx.project.msdyn_progress);
  lines.push(`Project is at ${progress}% overall completion.`);

  if (statusCtx.mostRecent?.msdyn_accomplishedactivities) {
    const carryForward = linesFromText(statusCtx.mostRecent.msdyn_accomplishedactivities, 2);
    for (const item of carryForward) {
      lines.push(`Carry-forward: ${item}`);
    }
  }

  const closedRisks = ctx.risks.filter((r) => r.statecode === 1);
  if (closedRisks.length > 0) {
    lines.push(`${closedRisks.length} risk(s) closed or mitigated this period.`);
  }

  const resolvedIssues = ctx.issues.filter((i) => i.statecode === 1);
  if (resolvedIssues.length > 0) {
    lines.push(`${resolvedIssues.length} issue(s) resolved or moved out of active state.`);
  }

  if (lines.length === 1) {
    lines.push('Execution updates were limited this period; review task-level progress with delivery leads.');
  }

  return lines.join('\n');
}

function draftPlannedActivities(ctx: ProjectContext): string {
  const lines: string[] = [];
  if (ctx.project.msdyn_finish) {
    const dueDate = new Date(ctx.project.msdyn_finish);
    lines.push(`Drive completion against the current target finish date (${dueDate.toLocaleDateString()}).`);
  } else {
    lines.push('Confirm next milestone dates with delivery owners and update project schedule baselines.');
  }

  const activeRisks = ctx.risks.filter((r) => r.statecode === 0);
  if (activeRisks.length > 0) {
    lines.push(`Advance mitigation plans for ${activeRisks.length} open risk(s).`);
  }

  const openIssues = ctx.issues.filter((i) => i.statecode === 0);
  if (openIssues.length > 0) {
    lines.push(`Work to resolve ${openIssues.length} open issue(s).`);
  }

  if (ctx.project.proj_overallhealth === 189330001 || ctx.project.proj_overallhealth === 189330002) {
    lines.push('Run focused checkpoint with PMO and functional owners to address current delivery health concerns.');
  }

  return lines.join('\n');
}

function draftAdditionalComments(ctx: ProjectContext): string {
  const lines: string[] = [];
  const highIssues = ctx.issues.filter(
    (i) => i.statecode === 0 && (i.proj_priority ?? 0) >= 3,
  );
  if (highIssues.length > 0) {
    lines.push(`${highIssues.length} high-priority issue(s) under active management.`);
  }
  if (ctx.project.proj_overallhealth === 189330002) {
    lines.push('Project is currently Off Track — escalation and corrective action in progress.');
  } else if (ctx.project.proj_overallhealth === 189330001) {
    lines.push('Project is At Risk — delivery exposure under close monitoring.');
  }

  const failedSources = ctx.sourceStatus.filter((s) => s.state === 'failed');
  if (failedSources.length > 0) {
    lines.push(`Some signals were unavailable: ${failedSources.map((s) => s.source).join(', ')}.`);
  }

  if (lines.length === 0) {
    lines.push('No additional concerns to report at this time.');
  }
  return lines.join('\n');
}

function buildSourceSignals(ctx: ProjectContext, statusCtx: StatusContext): string[] {
  const signals: string[] = [];
  signals.push(`Progress: ${normPct(ctx.project.msdyn_progress)}%`);
  signals.push(`Active risks: ${ctx.risks.filter((r) => r.statecode === 0).length}`);
  signals.push(`Active issues: ${ctx.issues.filter((i) => i.statecode === 0).length}`);
  if (statusCtx.mostRecent) {
    const d = statusCtx.mostRecent.proj_reportingdate ?? statusCtx.mostRecent.createdon;
    signals.push(`Prior report: ${d ? new Date(d).toLocaleDateString() : 'date unknown'}`);
  } else {
    signals.push('Prior report: none found — first draft for this project.');
  }

  for (const source of [...ctx.sourceStatus, ...statusCtx.sourceStatus]) {
    if (source.state === 'failed') {
      signals.push(`Source warning: ${source.source} failed to load.`);
    } else if (source.state === 'missing') {
      signals.push(`Source note: ${source.source} returned no records.`);
    }
  }

  return signals;
}

function deriveConfidence(ctx: ProjectContext, statusCtx: StatusContext): 'high' | 'medium' | 'low' {
  const failed = [...ctx.sourceStatus, ...statusCtx.sourceStatus].filter((s) => s.state === 'failed').length;
  const missing = [...ctx.sourceStatus, ...statusCtx.sourceStatus].filter((s) => s.state === 'missing').length;

  let richness = 0;
  if (ctx.project.msdyn_progress != null) richness += 1;
  if (ctx.risks.length > 0) richness += 1;
  if (ctx.issues.length > 0) richness += 1;
  if (statusCtx.mostRecent) richness += 1;

  if (failed > 0) return 'low';
  if (richness >= 3 && missing <= 1) return 'high';
  if (richness >= 2) return 'medium';
  return 'low';
}

export function draftWeeklyStatusReport(
  ctx: ProjectContext,
  statusCtx: StatusContext,
): StatusReportDraft {
  const sourceStatus = [...ctx.sourceStatus, ...statusCtx.sourceStatus];

  return {
    topicId: 'draft-weekly-status-report',
    mode: 'draft',
    projectId: ctx.project.msdyn_projectid,
    projectName: ctx.project.msdyn_subject,
    reportingPeriod: currentReportingWeek(),
    accomplishedActivities: draftAccomplishedActivities(ctx, statusCtx),
    plannedActivities: draftPlannedActivities(ctx),
    additionalComments: draftAdditionalComments(ctx),
    sourceSignals: buildSourceSignals(ctx, statusCtx),
    sourceStatus,
    confidence: deriveConfidence(ctx, statusCtx),
    generatedAt: new Date().toISOString(),
  };
}
