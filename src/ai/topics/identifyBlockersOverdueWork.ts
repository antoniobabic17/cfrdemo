/**
 * identify-blockers-overdue-work topic - Wave 2 advisory output.
 * Identifies high-friction blockers and overdue work using triage context.
 */

import type { TriageContext } from '../context/triageContext';
import type { BlockersOverdueWorkAdvisory } from '../contracts';

export function identifyBlockersOverdueWork(ctx: TriageContext): BlockersOverdueWorkAdvisory {
  const today = new Date();

  const blockers = ctx.projects
    .filter((p) => (p.proj_activeissues ?? 0) > 0 || (p.proj_activerisks ?? 0) > 1)
    .slice(0, 8)
    .map((p) => `${p.msdyn_subject}: ${p.proj_activeissues ?? 0} issue(s), ${p.proj_activerisks ?? 0} risk(s).`);

  const overdueItems = ctx.projects
    .filter((p) => p.msdyn_finish && new Date(p.msdyn_finish).getTime() < today.getTime())
    .slice(0, 8)
    .map((p) => `${p.msdyn_subject} is past planned finish date (${new Date(p.msdyn_finish!).toLocaleDateString()}).`);

  const recommendedActions = [
    'Escalate top blockers in weekly PMO governance review.',
    'Assign dated owners for overdue recovery actions.',
    'Re-baseline milestones only after mitigation plans are approved.',
  ];

  const summary =
    blockers.length === 0 && overdueItems.length === 0
      ? 'No material blocker or overdue work signals were detected from current context.'
      : `Detected ${blockers.length} blocker signal(s) and ${overdueItems.length} overdue work item(s).`;

  return {
    topicId: 'identify-blockers-overdue-work',
    mode: 'advisory',
    scope: ctx.scope,
    summary,
    blockers,
    overdueItems,
    recommendedActions,
    sourceStatus: ctx.sourceStatus,
    confidence: ctx.sourceStatus.some((s) => s.state === 'failed') ? 'low' : 'high',
    generatedAt: new Date().toISOString(),
  };
}
