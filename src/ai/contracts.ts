/**
 * Mira Wave 1 — output contract types.
 * Mode: advisory (explain-project-health, explain-program-health) and draft (draft-weekly-status-report).
 * No write-intent payloads or mutation paths in Wave 1.
 */

export type MiraTopic =
  | 'explain-project-health'
  | 'explain-program-health'
  | 'draft-weekly-status-report'
  | 'what-are-my-open-tasks'
  | 'what-needs-my-attention'
  | 'what-changed-since-last-status-report'
  | 'what-is-blocking-this-project-right-now'
  | 'pmo-triage-needs-attention'
  | 'report-bug'
  | 'suggest-enhancement'
  | 'draft-wbs-task-plan'
  | 'assess-project-risk'
  | 'improve-status-report-draft'
  | 'identify-blockers-overdue-work'
  | 'submit-intake-request';

export type MiraMode = 'advisory' | 'draft';

export type HealthLabel = 'On Track' | 'At Risk' | 'Off Track' | 'Unknown';
export type SignalStatus = 'ok' | 'warn' | 'critical';
export type Confidence = 'high' | 'medium' | 'low';
export type SourceState = 'ok' | 'missing' | 'failed';
export type AdvisorySeverity = 'high' | 'medium' | 'low';

export interface SourceStatus {
  source: string;
  state: SourceState;
  detail?: string;
}

export interface HealthSignal {
  dimension: string;
  value: string;
  status: SignalStatus;
}

export interface ProgramProjectRollup {
  total: number;
  onTrack: number;
  atRisk: number;
  offTrack: number;
}

/** Output contract for explain-project-health (advisory). */
export interface ProjectHealthAdvisory {
  topicId: 'explain-project-health';
  mode: 'advisory';
  projectId: string;
  projectName: string;
  overallHealth: HealthLabel;
  healthSignals: HealthSignal[];
  summary: string;
  attentionItems: string[];
  sourceStatus: SourceStatus[];
  confidence: Confidence;
  generatedAt: string;
}

/** Output contract for explain-program-health (advisory). */
export interface ProgramHealthAdvisory {
  topicId: 'explain-program-health';
  mode: 'advisory';
  programId: string;
  programName: string;
  overallHealth: HealthLabel;
  healthSignals: HealthSignal[];
  projectRollup: ProgramProjectRollup;
  summary: string;
  attentionItems: string[];
  sourceStatus: SourceStatus[];
  confidence: Confidence;
  generatedAt: string;
}

/** Output contract for draft-weekly-status-report (draft). */
export interface StatusReportDraft {
  topicId: 'draft-weekly-status-report';
  mode: 'draft';
  projectId: string;
  projectName: string;
  reportingPeriod: string;
  accomplishedActivities: string;
  plannedActivities: string;
  additionalComments: string;
  sourceSignals: string[];
  sourceStatus: SourceStatus[];
  confidence: Confidence;
  generatedAt: string;
}

export type TaskDueState = 'overdue' | 'due-soon' | 'on-track' | 'unscheduled';
export type TaskOwnershipState = 'assigned' | 'unassigned';

/** Output contract for what-are-my-open-tasks (advisory). */
export interface OpenTaskItem {
  taskId: string;
  taskName: string;
  progressPercent: number;
  dueDate?: string;
  dueState: TaskDueState;
  ownershipState: TaskOwnershipState;
  assignees: string[];
  isMilestone: boolean;
}

export interface OpenTasksAdvisory {
  topicId: 'what-are-my-open-tasks';
  mode: 'advisory';
  projectId: string;
  projectName: string;
  summary: string;
  openTaskCount: number;
  overdueTaskCount: number;
  dueSoonTaskCount: number;
  unassignedTaskCount: number;
  tasks: OpenTaskItem[];
  sourceStatus: SourceStatus[];
  confidence: Confidence;
  generatedAt: string;
}

export interface DeliveryAttentionItem {
  category: 'health' | 'issue' | 'risk' | 'task' | 'status';
  title: string;
  detail: string;
  severity: AdvisorySeverity;
  recommendedAction: string;
}

export interface StatusChangeItem {
  category: 'risk' | 'issue' | 'task' | 'status';
  summary: string;
}

export interface NeedsAttentionAdvisory {
  topicId: 'what-needs-my-attention';
  mode: 'advisory';
  projectId: string;
  projectName: string;
  summary: string;
  attentionItems: DeliveryAttentionItem[];
  sourceStatus: SourceStatus[];
  confidence: Confidence;
  generatedAt: string;
}

export interface StatusChangesAdvisory {
  topicId: 'what-changed-since-last-status-report';
  mode: 'advisory';
  projectId: string;
  projectName: string;
  baselineDate?: string;
  summary: string;
  changeItems: StatusChangeItem[];
  sourceStatus: SourceStatus[];
  confidence: Confidence;
  generatedAt: string;
}

export interface ProjectBlockersAdvisory {
  topicId: 'what-is-blocking-this-project-right-now';
  mode: 'advisory';
  projectId: string;
  projectName: string;
  summary: string;
  blockerItems: DeliveryAttentionItem[];
  sourceStatus: SourceStatus[];
  confidence: Confidence;
  generatedAt: string;
}

/** Output contract for pmo-triage-needs-attention (advisory). */
export interface TriageAttentionItem {
  rank: number;
  scope: 'project' | 'program' | 'portfolio';
  entityId?: string;
  title: string;
  whyNow: string;
  recommendedNextStep: string;
  severity: 'high' | 'medium' | 'low';
}

export interface TriageSummary {
  topicId: 'pmo-triage-needs-attention';
  mode: 'advisory';
  scope: 'project' | 'program' | 'portfolio';
  summary: string;
  rankedAttentionItems: TriageAttentionItem[];
  sourceStatus: SourceStatus[];
  confidence: Confidence;
  generatedAt: string;
}

/** Output contract for report-bug (draft-only in Wave 2). */
export interface BugReportDraft {
  topicId: 'report-bug';
  mode: 'draft';
  sourceRoute: string;
  sourceEntityId?: string;
  sourceEntityType?: 'project' | 'program' | 'other';
  userDescription: string;
  structuredDraft: string;
  sourceStatus: SourceStatus[];
  confidence: Confidence;
  generatedAt: string;
}

/** Output contract for suggest-enhancement (draft-only in Wave 2). */
export interface EnhancementSuggestionDraft {
  topicId: 'suggest-enhancement';
  mode: 'draft';
  sourceRoute: string;
  sourceEntityId?: string;
  sourceEntityType?: 'project' | 'program' | 'other';
  userDescription: string;
  structuredDraft: string;
  sourceStatus: SourceStatus[];
  confidence: Confidence;
  generatedAt: string;
}

/** Output contract for draft-wbs-task-plan (draft-only in Wave 2). */
export interface WbsTaskPlanDraft {
  topicId: 'draft-wbs-task-plan';
  mode: 'draft';
  projectId: string;
  projectName: string;
  planningAssumptions: string[];
  draftTasks: string;
  sourceStatus: SourceStatus[];
  confidence: Confidence;
  generatedAt: string;
}

/** Output contract for assess-project-risk (advisory in Wave 2). */
export interface ProjectRiskAssessmentAdvisory {
  topicId: 'assess-project-risk';
  mode: 'advisory';
  projectId: string;
  projectName: string;
  riskScore: number;
  topRisks: string[];
  mitigationRecommendations: string[];
  sourceStatus: SourceStatus[];
  confidence: Confidence;
  generatedAt: string;
}

/** Output contract for improve-status-report-draft (draft-only in Wave 2). */
export interface ImprovedStatusReportDraft {
  topicId: 'improve-status-report-draft';
  mode: 'draft';
  projectId?: string;
  projectName?: string;
  originalDraft: string;
  improvedDraft: string;
  improvementNotes: string[];
  sourceStatus: SourceStatus[];
  confidence: Confidence;
  generatedAt: string;
}

/** Output contract for identify-blockers-overdue-work (advisory in Wave 2). */
export interface BlockersOverdueWorkAdvisory {
  topicId: 'identify-blockers-overdue-work';
  mode: 'advisory';
  scope: 'project' | 'program' | 'portfolio';
  summary: string;
  blockers: string[];
  overdueItems: string[];
  recommendedActions: string[];
  sourceStatus: SourceStatus[];
  confidence: Confidence;
  generatedAt: string;
}

/** Mutation payload for record creation (Wave 3). */
export interface BugReportMutation {
  topicId: 'report-bug';
  mode: 'mutation';
  sourceRoute: string;
  sourceEntityId?: string;
  sourceEntityType?: 'project' | 'program' | 'other';
  userDescription: string;
  structuredDraft: string;
  /* Dataverse pmo_ProjectRequest fields */
  requestType: 'Bug Report'; // literal for filter
  title: string;
  description: string;
  reproductionStepsUrl: string; // route reference
  affectedEntityRef: string; // "project:entityId" or "program:entityId"
  severity: 'High' | 'Medium' | 'Low'; // derived from confidence/context
  status: 'New'; // literal for initial state
  createdBy: string; // user ID from session
  createdAt: string; // ISO timestamp
  recordId?: string; // Dataverse GUID after creation
  creationResult: 'pending' | 'success' | 'failed';
  failureReason?: string;
  failureCode?: string;
  telemetryId?: string;
  sourceStatus: SourceStatus[];
  confidence: Confidence;
  generatedAt: string;
}

export interface EnhancementSuggestionMutation {
  topicId: 'suggest-enhancement';
  mode: 'mutation';
  sourceRoute: string;
  sourceEntityId?: string;
  sourceEntityType?: 'project' | 'program' | 'other';
  userDescription: string;
  structuredDraft: string;
  /* Dataverse pmo_ProjectRequest fields */
  requestType: 'Enhancement Request'; // literal for filter
  title: string;
  description: string;
  suggestedFeatureUrl: string; // route reference
  affectedEntityRef: string; // "project:entityId" or "program:entityId"
  priority: 'High' | 'Medium' | 'Low'; // derived from frequency/scope
  status: 'New'; // literal for initial state
  createdBy: string; // user ID from session
  createdAt: string; // ISO timestamp
  recordId?: string; // Dataverse GUID after creation
  creationResult: 'pending' | 'success' | 'failed';
  failureReason?: string;
  failureCode?: string;
  telemetryId?: string;
  sourceStatus: SourceStatus[];
  confidence: Confidence;
  generatedAt: string;
}

/** Output contract for submit-intake-request (Phase 2 — Copilot Studio topic). */
export interface IntakeRequestDraft {
  topicId: 'submit-intake-request';
  mode: 'draft';
  submissionText: string;
  extractedTitle: string;
  routingRecommendation: string;
  routingConfidence: number;
  extractedFieldsJson: string;
  targetTeamId?: string;
  lineOfBusiness?: number;
  affectedSystemId?: string;
  enrichmentPack?: string;
  sourceStatus: SourceStatus[];
  confidence: Confidence;
  generatedAt: string;
}

export interface IntakeRequestMutation extends Omit<IntakeRequestDraft, 'mode'> {
  mode: 'mutation';
  recordId?: string;
  creationResult: 'pending' | 'success' | 'failed';
  failureReason?: string;
  failureCode?: string;
  telemetryId?: string;
}

export type MiraTopicResult =
  | ProjectHealthAdvisory
  | ProgramHealthAdvisory
  | StatusReportDraft
  | OpenTasksAdvisory
  | NeedsAttentionAdvisory
  | StatusChangesAdvisory
  | ProjectBlockersAdvisory
  | TriageSummary
  | BugReportDraft
  | EnhancementSuggestionDraft
  | WbsTaskPlanDraft
  | ProjectRiskAssessmentAdvisory
  | ImprovedStatusReportDraft
  | BlockersOverdueWorkAdvisory
  | BugReportMutation
  | EnhancementSuggestionMutation
  | IntakeRequestDraft
  | IntakeRequestMutation;
