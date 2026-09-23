/**
 * Mira Wave 1 — public barrel export.
 * Exports all contracts, context loaders, and topic functions.
 */

// Contracts
export type {
  MiraTopic,
  MiraMode,
  MiraTopicResult,
  HealthLabel,
  SignalStatus,
  Confidence,
  SourceState,
  SourceStatus,
  AdvisorySeverity,
  TaskDueState,
  TaskOwnershipState,
  HealthSignal,
  ProgramProjectRollup,
  ProjectHealthAdvisory,
  ProgramHealthAdvisory,
  StatusReportDraft,
  OpenTaskItem,
  OpenTasksAdvisory,
  DeliveryAttentionItem,
  StatusChangeItem,
  NeedsAttentionAdvisory,
  StatusChangesAdvisory,
  ProjectBlockersAdvisory,
  TriageAttentionItem,
  TriageSummary,
  BugReportDraft,
  EnhancementSuggestionDraft,
  WbsTaskPlanDraft,
  ProjectRiskAssessmentAdvisory,
  ImprovedStatusReportDraft,
  BlockersOverdueWorkAdvisory,
  BugReportMutation,
  EnhancementSuggestionMutation,
  IntakeRequestDraft,
  IntakeRequestMutation,
} from './contracts';

// Context loaders
export { loadProjectContext } from './context/projectContext';
export type { ProjectContext } from './context/projectContext';

export { loadProgramContextEnriched } from './context/programContext';
export type { ProgramContext, ProgramStatusFreshness } from './context/programContext';

export { loadStatusContext } from './context/statusContext';
export type { StatusContext } from './context/statusContext';

export { loadProjectOpenTasksContext } from './context/projectOpenTasksContext';
export type { ProjectOpenTasksContext } from './context/projectOpenTasksContext';

export { loadTriageContext } from './context/triageContext';
export type { TriageContext } from './context/triageContext';

// Topics — Wave 1
export { explainProjectHealth } from './topics/explainProjectHealth';
export { explainProgramHealth } from './topics/explainProgramHealth';
export { draftWeeklyStatusReport } from './topics/draftWeeklyStatusReport';
export { whatAreMyOpenTasks } from './topics/whatAreMyOpenTasks';
export { whatNeedsMyAttention } from './topics/whatNeedsMyAttention';
export { whatChangedSinceLastStatusReport } from './topics/whatChangedSinceLastStatusReport';
export { whatIsBlockingThisProjectRightNow } from './topics/whatIsBlockingThisProjectRightNow';
export { pmoTriageNeedsAttention } from './topics/pmoTriageNeedsAttention';
export { reportBug } from './topics/reportBug';
export { suggestEnhancement } from './topics/suggestEnhancement';
export { draftWbsTaskPlan } from './topics/draftWbsTaskPlan';
export { assessProjectRisk } from './topics/assessProjectRisk';
export { improveStatusReportDraft } from './topics/improveStatusReportDraft';
export { identifyBlockersOverdueWork } from './topics/identifyBlockersOverdueWork';

// Grounding utilities (exported for testing)
export { resolveHealthLabel, resolveHealthStatus } from './grounding/signals';

// Mutations — Wave 3 (write-intent with approval gates) + Phase 2 intake
export {
  prepareBugReportMutation,
  prepareEnhancementSuggestionMutation,
  createBugReportRecord,
  createEnhancementSuggestionRecord,
  createIntakeRequestRecord,
  prepareRetryMutation,
} from './mutations';
