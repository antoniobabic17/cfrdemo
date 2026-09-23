/**
 * draft-wbs-task-plan topic - Wave 2 draft output.
 * Builds a draft WBS-style task plan from project context signals.
 */

import type { ProjectContext } from '../context/projectContext';
import type { WbsTaskPlanDraft } from '../contracts';

function buildDraftTasks(ctx: ProjectContext): string {
  const lines: string[] = [];
  lines.push('1. Discovery and Planning');
  lines.push('   - Confirm scope baseline and delivery assumptions.');
  lines.push('   - Validate stakeholders, dependencies, and milestone dates.');
  lines.push('2. Execution');
  lines.push('   - Execute prioritized work packages for current sprint window.');
  lines.push('   - Track progress, risks, and issues in weekly cadence.');
  lines.push('3. Validation and Handover');
  lines.push('   - Validate deliverables against acceptance criteria.');
  lines.push('   - Prepare stakeholder handoff and operational readiness.');

  const openRisks = ctx.risks.filter((r) => r.statecode === 0).length;
  const openIssues = ctx.issues.filter((i) => i.statecode === 0).length;
  lines.push('');
  lines.push(`Risk and issue focus: ${openRisks} open risk(s), ${openIssues} open issue(s).`);

  return lines.join('\n');
}

export function draftWbsTaskPlan(ctx: ProjectContext): WbsTaskPlanDraft {
  return {
    topicId: 'draft-wbs-task-plan',
    mode: 'draft',
    projectId: ctx.project.msdyn_projectid,
    projectName: ctx.project.msdyn_subject,
    planningAssumptions: [
      'Scope and priority remain stable during the next delivery window.',
      'Current project health and open blockers are reflected in PMO data.',
      'Final task owners and durations must be confirmed by delivery leads.',
    ],
    draftTasks: buildDraftTasks(ctx),
    sourceStatus: ctx.sourceStatus,
    confidence: ctx.sourceStatus.some((s) => s.state === 'failed') ? 'low' : 'medium',
    generatedAt: new Date().toISOString(),
  };
}
