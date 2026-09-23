import { CFR_CATEGORY } from './constants';

export interface TemplateTask {
  subject: string;
  isMilestone?: boolean;
  duration?: number; // hours
}

/** Standard WBS templates keyed by CFR_CATEGORY value. Flat task lists — no bucket or parent binding. */
export const PROJECT_TEMPLATES: Partial<Record<number, TemplateTask[]>> = {
  [CFR_CATEGORY.ItInfrastructure]: [
    { subject: 'Requirements gathering', duration: 16 },
    { subject: 'Infrastructure assessment', duration: 24 },
    { subject: 'Discovery complete', isMilestone: true },
    { subject: 'Architecture design', duration: 40 },
    { subject: 'Design review and approval', isMilestone: true },
    { subject: 'Build and configure', duration: 80 },
    { subject: 'Testing and QA', duration: 40 },
    { subject: 'Go-live', isMilestone: true },
    { subject: 'Post-implementation review', duration: 8 },
    { subject: 'Project closed', isMilestone: true },
  ],
  [CFR_CATEGORY.FinanceSystems]: [
    { subject: 'Stakeholder alignment', duration: 8 },
    { subject: 'Scope and requirements definition', duration: 16 },
    { subject: 'Planning complete', isMilestone: true },
    { subject: 'System configuration', duration: 40 },
    { subject: 'Data migration planning', duration: 16 },
    { subject: 'Integration testing', duration: 24 },
    { subject: 'User acceptance testing', duration: 40 },
    { subject: 'Audit and compliance review', duration: 16 },
    { subject: 'UAT sign-off', isMilestone: true },
    { subject: 'Cutover execution', duration: 8 },
    { subject: 'Go-live', isMilestone: true },
  ],
  [CFR_CATEGORY.Compliance]: [
    { subject: 'Current state gap analysis', duration: 24 },
    { subject: 'Regulatory requirements mapping', duration: 16 },
    { subject: 'Assessment complete', isMilestone: true },
    { subject: 'Control implementation', duration: 40 },
    { subject: 'Policy updates', duration: 16 },
    { subject: 'Evidence collection', duration: 24 },
    { subject: 'Internal audit review', duration: 16 },
    { subject: 'External validation', duration: 24 },
    { subject: 'Compliance certification', isMilestone: true },
  ],
  [CFR_CATEGORY.DataAndAnalytics]: [
    { subject: 'Data source inventory', duration: 16 },
    { subject: 'Business requirements definition', duration: 16 },
    { subject: 'Discovery complete', isMilestone: true },
    { subject: 'Data model design', duration: 24 },
    { subject: 'Dashboard / report mockups', duration: 16 },
    { subject: 'Design approved', isMilestone: true },
    { subject: 'Data pipeline development', duration: 40 },
    { subject: 'Report / dashboard development', duration: 40 },
    { subject: 'Testing and validation', duration: 24 },
    { subject: 'UAT sign-off', isMilestone: true },
    { subject: 'Production deployment', duration: 8 },
    { subject: 'User training', duration: 8 },
    { subject: 'Go-live', isMilestone: true },
  ],
  [CFR_CATEGORY.Operations]: [
    { subject: 'Process analysis', duration: 16 },
    { subject: 'Stakeholder engagement', duration: 8 },
    { subject: 'Project kick-off', isMilestone: true },
    { subject: 'Solution design', duration: 24 },
    { subject: 'Implementation', duration: 40 },
    { subject: 'Testing', duration: 16 },
    { subject: 'Training and handover', duration: 8 },
    { subject: 'Project closed', isMilestone: true },
  ],
  [CFR_CATEGORY.Other]: [
    { subject: 'Requirements definition', duration: 16 },
    { subject: 'Planning complete', isMilestone: true },
    { subject: 'Implementation', duration: 40 },
    { subject: 'Testing', duration: 16 },
    { subject: 'Delivery', isMilestone: true },
    { subject: 'Lessons learned', duration: 4 },
    { subject: 'Project closed', isMilestone: true },
  ],
};

export const CFR_CATEGORY_LABELS: Record<number, string> = {
  893460050: 'IT Infrastructure',
  893460051: 'Finance Systems',
  893460052: 'Compliance',
  893460053: 'Data & Analytics',
  893460054: 'Operations',
  893460055: 'Other',
};
