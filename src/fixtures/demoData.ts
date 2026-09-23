import type { ProjectRequest } from '../models/projectRequest.model';
import type { Project } from '../models/project.model';
import type { ProjectRisk } from '../models/projectRisk.model';
import type { ProjectIssue } from '../models/projectIssue.model';
import type { ProjectChange } from '../models/projectChange.model';
import type { ProjectDecision } from '../models/projectDecision.model';
import type { StatusReport } from '../models/statusReport.model';
import type { GateSetTemplate, GateSetItem } from '../models/gateSetTemplate.model';

// ─── Shared fake IDs ──────────────────────────────────────────────────────────
const TEAM_A_ID = 'd3d6c11d-5819-44ce-8d23-3155add83792';
const TEAM_B_ID = '520562eb-e7c7-46af-8cbd-a02aa800ef1f';
const TEAM_C_ID = '9147cd92-e1d9-4d8e-84f9-cbe7e7d9af2a';
const TEAM_D_ID = 'f9466826-ccdd-479d-829b-c3769bfcab4f';
const TEAM_E_ID = 'b8ce79d3-a6df-47f9-8986-7ccb43346c19';
const USER_1_ID = 'fc8d0392-78ca-462e-8bab-47d4bfe7044a';
const USER_2_ID = 'bc02c446-8821-40ec-82b9-59c4c39d1340';
const USER_3_ID = 'a8beda40-2ced-4d98-8715-1c2245649ef6';
const USER_4_ID = 'f874871e-063f-4fb5-8c0e-aeb9b54616f2';
const USER_5_ID = 'b2b97186-76ae-4f44-88c9-cb255b7e6fd0';
const PROJECT_1 = '2c065944-18f7-41f8-87b2-1a859fd78f95';
const PROJECT_2 = '585789b3-12f5-4d77-86f2-9880868bc191';
const PROJECT_3 = '59f4f47e-5638-47bf-80f3-784c1635135b';
const PROJECT_4 = 'ae7ba423-a77e-4034-8b4b-53b9a7db8ac6';
const PROGRAM_1 = '690f1a1a-22d5-4b91-8680-efdbce5e3b71';
const PROGRAM_2 = 'ffcdedfc-6e9f-4c0b-8818-7b6d576c13cd';
const WORKFLOW_A = '0767a6f6-1687-4bbf-8446-3b35fc366666';
const WORKFLOW_B = 'de26cbba-6fec-4a08-842f-32f2b3c32e9a';

// ─── Project Requests ─────────────────────────────────────────────────────────
export const DEMO_PROJECT_REQUESTS: ProjectRequest[] = [
  {
    pmo_projectrequestid: '01aef701-3d46-448a-872b-572d96f573d3',
    pmo_name: 'Initiative 1 — System Integration',
    pmo_autonumber: 'REQ-2025-0042',
    pmo_description: 'Extend system integration to support automated eligibility verification and real-time status tracking.',
    pmo_requesttype: 893460000,
    'pmo_requesttype@OData.Community.Display.V1.FormattedValue': 'New Project',
    pmo_priority: 893460010,
    'pmo_priority@OData.Community.Display.V1.FormattedValue': 'Critical',
    pmo_status: 893460022,
    'pmo_status@OData.Community.Display.V1.FormattedValue': 'In Triage',
    pmo_estimatedbudget: 485000,
    pmo_requestedstartdate: '2025-09-01',
    pmo_targetcompletiondate: '2026-03-31',
    pmo_routingconfidence: 0.94,
    pmo_outcomecategory: 0,
    'pmo_outcomecategory@OData.Community.Display.V1.FormattedValue': 'Project',
    pmo_lineofbusiness: 893460101,
    'pmo_lineofbusiness@OData.Community.Display.V1.FormattedValue': 'Division 1',
    '_pmo_requestedby_value': USER_1_ID,
    '_pmo_requestedby_value@OData.Community.Display.V1.FormattedValue': 'User 1',
    '_pmo_targetteam_value': TEAM_A_ID,
    '_pmo_targetteam_value@OData.Community.Display.V1.FormattedValue': 'Team 1',
    '_pmo_intakeworkflowid_value': WORKFLOW_A,
    '_pmo_intakeworkflowid_value@OData.Community.Display.V1.FormattedValue': 'Standard Intake Workflow',
    pmo_currentstagenumber: 1,
    statecode: 0,
    createdon: '2025-07-14T09:22:00Z',
    modifiedon: '2025-07-14T14:35:00Z',
  },
  {
    pmo_projectrequestid: '50f8dd35-8de6-4747-8f22-59626d4651bc',
    pmo_name: 'Initiative 2 — Platform Enhancement',
    pmo_autonumber: 'REQ-2025-0041',
    pmo_description: 'Redesign the platform to meet accessibility standards and optimize for mobile use.',
    pmo_requesttype: 893460002,
    'pmo_requesttype@OData.Community.Display.V1.FormattedValue': 'Enhancement',
    pmo_priority: 893460011,
    'pmo_priority@OData.Community.Display.V1.FormattedValue': 'High',
    pmo_status: 893460021,
    'pmo_status@OData.Community.Display.V1.FormattedValue': 'Submitted',
    pmo_estimatedbudget: 125000,
    pmo_requestedstartdate: '2025-10-01',
    pmo_targetcompletiondate: '2026-01-31',
    pmo_routingconfidence: 0.81,
    pmo_lineofbusiness: 893460100,
    'pmo_lineofbusiness@OData.Community.Display.V1.FormattedValue': 'Division 2',
    '_pmo_requestedby_value': USER_2_ID,
    '_pmo_requestedby_value@OData.Community.Display.V1.FormattedValue': 'User 2',
    '_pmo_intakeworkflowid_value': WORKFLOW_B,
    '_pmo_intakeworkflowid_value@OData.Community.Display.V1.FormattedValue': 'Expedited Intake Workflow',
    pmo_currentstagenumber: 1,
    statecode: 0,
    createdon: '2025-07-10T11:00:00Z',
    modifiedon: '2025-07-10T11:00:00Z',
  },
  {
    pmo_projectrequestid: 'fbea7570-a788-4420-811a-475d8c639064',
    pmo_name: 'Initiative 3 — Analytics Pipeline',
    pmo_autonumber: 'REQ-2025-0039',
    pmo_description: 'Implement automated analytics pipeline to reduce manual processing volume by 40%.',
    pmo_requesttype: 893460000,
    'pmo_requesttype@OData.Community.Display.V1.FormattedValue': 'New Project',
    pmo_priority: 893460011,
    'pmo_priority@OData.Community.Display.V1.FormattedValue': 'High',
    pmo_status: 893460023,
    'pmo_status@OData.Community.Display.V1.FormattedValue': 'Approved',
    pmo_estimatedbudget: 720000,
    pmo_requestedstartdate: '2025-08-15',
    pmo_targetcompletiondate: '2026-06-30',
    pmo_routingconfidence: 0.97,
    pmo_outcomecategory: 0,
    '_pmo_requestedby_value': USER_3_ID,
    '_pmo_requestedby_value@OData.Community.Display.V1.FormattedValue': 'User 3',
    '_pmo_targetteam_value': TEAM_B_ID,
    '_pmo_targetteam_value@OData.Community.Display.V1.FormattedValue': 'Team 2',
    '_pmo_approvedby_value': USER_1_ID,
    '_pmo_approvedby_value@OData.Community.Display.V1.FormattedValue': 'User 1',
    statecode: 0,
    createdon: '2025-06-28T08:15:00Z',
    modifiedon: '2025-07-05T16:20:00Z',
  },
  {
    pmo_projectrequestid: '7787ecb7-b39f-42cc-88ae-4968f14e9582',
    pmo_name: 'Initiative 4 — Regulatory Reporting',
    pmo_autonumber: 'REQ-2025-0035',
    pmo_description: 'Update reporting pipeline to meet new regulatory requirements effective Q4.',
    pmo_requesttype: 893460003,
    'pmo_requesttype@OData.Community.Display.V1.FormattedValue': 'Support',
    pmo_priority: 893460010,
    'pmo_priority@OData.Community.Display.V1.FormattedValue': 'Critical',
    pmo_status: 893460025,
    'pmo_status@OData.Community.Display.V1.FormattedValue': 'Converted',
    pmo_estimatedbudget: 95000,
    pmo_requestedstartdate: '2025-07-01',
    pmo_targetcompletiondate: '2025-09-30',
    '_pmo_requestedby_value': USER_1_ID,
    '_pmo_requestedby_value@OData.Community.Display.V1.FormattedValue': 'User 1',
    '_pmo_convertedproject_value': PROJECT_1,
    '_pmo_convertedproject_value@OData.Community.Display.V1.FormattedValue': 'Project 1',
    pmo_converteddate: '2025-07-02T00:00:00Z',
    statecode: 0,
    createdon: '2025-06-15T09:00:00Z',
    modifiedon: '2025-07-02T10:00:00Z',
  },
  {
    pmo_projectrequestid: 'ea666451-70da-4951-82b6-4af83b7793d6',
    pmo_name: 'Initiative 5 — Operational Dashboard',
    pmo_autonumber: 'REQ-2025-0031',
    pmo_description: 'Build a centralized operational dashboard to surface root-cause trends and improve visibility.',
    pmo_requesttype: 893460000,
    'pmo_requesttype@OData.Community.Display.V1.FormattedValue': 'New Project',
    pmo_priority: 893460012,
    'pmo_priority@OData.Community.Display.V1.FormattedValue': 'Medium',
    pmo_status: 893460022,
    'pmo_status@OData.Community.Display.V1.FormattedValue': 'In Triage',
    pmo_estimatedbudget: 200000,
    pmo_requestedstartdate: '2025-09-15',
    pmo_targetcompletiondate: '2026-02-28',
    pmo_routingconfidence: 0.76,
    '_pmo_requestedby_value': USER_2_ID,
    '_pmo_requestedby_value@OData.Community.Display.V1.FormattedValue': 'User 2',
    '_pmo_intakeworkflowid_value': WORKFLOW_A,
    '_pmo_intakeworkflowid_value@OData.Community.Display.V1.FormattedValue': 'Standard Intake Workflow',
    pmo_currentstagenumber: 2,
    statecode: 0,
    createdon: '2025-06-02T14:30:00Z',
    modifiedon: '2025-06-03T09:00:00Z',
  },
];

// ─── Programs ─────────────────────────────────────────────────────────────────
export const DEMO_PROGRAMS = [
  {
    msdyn_projectprogramid: PROGRAM_1,
    msdyn_name: 'Program 1',
    msdyn_description: 'Strategic program encompassing related initiatives.',
    statecode: 0,
    createdon: '2025-01-01T00:00:00Z',
  },
  {
    msdyn_projectprogramid: PROGRAM_2,
    msdyn_name: 'Program 2',
    msdyn_description: 'Operational improvement program.',
    statecode: 0,
    createdon: '2025-03-01T00:00:00Z',
  },
];

// ─── Projects ─────────────────────────────────────────────────────────────────
export const DEMO_PROJECTS: Project[] = [
  {
    msdyn_projectid: PROJECT_1,
    msdyn_subject: 'Project 1',
    msdyn_description: 'Update reporting pipeline to meet new regulatory requirements.',
    msdyn_scheduledstart: '2025-07-01',
    msdyn_finish: '2025-09-30',
    msdyn_progress: 62,
    proj_stage: 192350000,
    'proj_stage@OData.Community.Display.V1.FormattedValue': 'Execution',
    proj_state: 0,
    'proj_state@OData.Community.Display.V1.FormattedValue': 'Active',
    proj_priority: 893460010,
    'proj_priority@OData.Community.Display.V1.FormattedValue': 'Critical',
    proj_overallhealth: 189330000,
    'proj_overallhealth@OData.Community.Display.V1.FormattedValue': 'On Track',
    proj_projecttype: 893460200,
    'proj_projecttype@OData.Community.Display.V1.FormattedValue': 'Compliance',
    '_msdyn_program_value': PROGRAM_1,
    '_msdyn_program_value@OData.Community.Display.V1.FormattedValue': 'Program 1',
    statecode: 0,
    createdon: '2025-07-02T00:00:00Z',
    modifiedon: '2025-07-14T08:00:00Z',
    'ownerid@OData.Community.Display.V1.FormattedValue': 'User 1',
  },
  {
    msdyn_projectid: PROJECT_2,
    msdyn_subject: 'Project 2',
    msdyn_description: 'Implement automated analytics pipeline to reduce manual processing volume.',
    msdyn_scheduledstart: '2025-08-15',
    msdyn_finish: '2026-06-30',
    msdyn_progress: 12,
    proj_stage: 192350001,
    'proj_stage@OData.Community.Display.V1.FormattedValue': 'Planning',
    proj_state: 0,
    'proj_state@OData.Community.Display.V1.FormattedValue': 'Active',
    proj_priority: 893460011,
    'proj_priority@OData.Community.Display.V1.FormattedValue': 'High',
    proj_overallhealth: 189330001,
    'proj_overallhealth@OData.Community.Display.V1.FormattedValue': 'At Risk',
    proj_projecttype: 893460201,
    'proj_projecttype@OData.Community.Display.V1.FormattedValue': 'Data & Analytics',
    '_msdyn_program_value': PROGRAM_1,
    '_msdyn_program_value@OData.Community.Display.V1.FormattedValue': 'Program 1',
    statecode: 0,
    createdon: '2025-07-05T00:00:00Z',
    modifiedon: '2025-07-13T16:00:00Z',
    'ownerid@OData.Community.Display.V1.FormattedValue': 'User 2',
  },
  {
    msdyn_projectid: PROJECT_3,
    msdyn_subject: 'Project 3',
    msdyn_description: 'Bi-directional integration for real-time data exchange across platforms.',
    msdyn_scheduledstart: '2025-03-01',
    msdyn_finish: '2025-10-31',
    msdyn_progress: 79,
    proj_stage: 192350000,
    'proj_stage@OData.Community.Display.V1.FormattedValue': 'Execution',
    proj_state: 0,
    'proj_state@OData.Community.Display.V1.FormattedValue': 'Active',
    proj_priority: 893460010,
    'proj_priority@OData.Community.Display.V1.FormattedValue': 'Critical',
    proj_overallhealth: 189330000,
    'proj_overallhealth@OData.Community.Display.V1.FormattedValue': 'On Track',
    proj_projecttype: 893460200,
    'proj_projecttype@OData.Community.Display.V1.FormattedValue': 'Compliance',
    '_msdyn_program_value': PROGRAM_2,
    '_msdyn_program_value@OData.Community.Display.V1.FormattedValue': 'Program 2',
    statecode: 0,
    createdon: '2025-03-01T00:00:00Z',
    modifiedon: '2025-07-12T11:00:00Z',
    'ownerid@OData.Community.Display.V1.FormattedValue': 'User 3',
  },
  {
    msdyn_projectid: PROJECT_4,
    msdyn_subject: 'Project 4',
    msdyn_description: 'Launch self-service portal to reduce call center volume and improve collections.',
    msdyn_scheduledstart: '2025-01-15',
    msdyn_finish: '2025-06-30',
    msdyn_progress: 100,
    proj_stage: 192350003,
    'proj_stage@OData.Community.Display.V1.FormattedValue': 'Closeout',
    proj_state: 1,
    'proj_state@OData.Community.Display.V1.FormattedValue': 'Completed',
    proj_priority: 893460011,
    'proj_priority@OData.Community.Display.V1.FormattedValue': 'High',
    proj_overallhealth: 189330000,
    'proj_overallhealth@OData.Community.Display.V1.FormattedValue': 'On Track',
    '_msdyn_program_value': PROGRAM_2,
    '_msdyn_program_value@OData.Community.Display.V1.FormattedValue': 'Program 2',
    statecode: 0,
    createdon: '2025-01-15T00:00:00Z',
    modifiedon: '2025-07-01T09:00:00Z',
    'ownerid@OData.Community.Display.V1.FormattedValue': 'User 1',
  },
];

// ─── Project Risks ────────────────────────────────────────────────────────────
export const DEMO_RISKS: ProjectRisk[] = [
  {
    msdyn_projectriskid: '39b1a6b5-5e83-4fc2-8291-4c90f561838a',
    msdyn_name: 'Risk 1 — Vendor dependency',
    msdyn_description: 'Third-party vendor scheduled to deprecate key API endpoints. Migration required before deadline.',
    proj_probability: 3,
    proj_impact: 4,
    proj_exposure: 12,
    proj_state: 0,
    'proj_state@OData.Community.Display.V1.FormattedValue': 'Active',
    '_msdyn_project_value': PROJECT_3,
    createdon: '2025-06-01T00:00:00Z',
    statecode: 0,
  },
  {
    msdyn_projectriskid: 'b7fae2ba-1924-43a9-8b0f-5ac45d31c1ba',
    msdyn_name: 'Risk 2 — Data quality',
    msdyn_description: 'Source dataset has approximately 15% missing fields which may impact accuracy below target thresholds.',
    proj_probability: 2,
    proj_impact: 4,
    proj_exposure: 8,
    proj_state: 0,
    'proj_state@OData.Community.Display.V1.FormattedValue': 'Active',
    '_msdyn_project_value': PROJECT_2,
    createdon: '2025-07-08T00:00:00Z',
    statecode: 0,
  },
];

// ─── Project Issues ───────────────────────────────────────────────────────────
export const DEMO_ISSUES: ProjectIssue[] = [
  {
    msdyn_projectissueid: '9a5ce45c-adf3-43b6-88c7-c9e834a5e408',
    msdyn_name: 'Issue 1 — Environment access',
    msdyn_description: 'Team 1 lacks access to the staging environment required for integration testing.',
    proj_issuecategory: 189330000,
    'proj_issuecategory@OData.Community.Display.V1.FormattedValue': 'Issue',
    proj_priority: 893460011,
    'proj_priority@OData.Community.Display.V1.FormattedValue': 'High',
    proj_state: 0,
    'proj_state@OData.Community.Display.V1.FormattedValue': 'Active',
    proj_duedate: '2025-08-15',
    '_msdyn_project_value': PROJECT_1,
    '_proj_assignedto_value': USER_1_ID,
    '_proj_assignedto_value@OData.Community.Display.V1.FormattedValue': 'User 1',
    createdon: '2025-07-10T00:00:00Z',
    statecode: 0,
  },
  {
    msdyn_projectissueid: 'dfb6ebb6-ceeb-4c39-87c7-45dbb53bacf3',
    msdyn_name: 'Issue 2 — Scope clarification needed',
    msdyn_description: 'Requirements for module B are ambiguous. Stakeholder alignment required before development starts.',
    proj_issuecategory: 189330000,
    'proj_issuecategory@OData.Community.Display.V1.FormattedValue': 'Issue',
    proj_priority: 893460012,
    'proj_priority@OData.Community.Display.V1.FormattedValue': 'Medium',
    proj_state: 0,
    'proj_state@OData.Community.Display.V1.FormattedValue': 'Active',
    proj_duedate: '2025-09-01',
    '_msdyn_project_value': PROJECT_2,
    '_proj_assignedto_value': USER_2_ID,
    '_proj_assignedto_value@OData.Community.Display.V1.FormattedValue': 'User 2',
    createdon: '2025-07-12T00:00:00Z',
    statecode: 0,
  },
  {
    msdyn_projectissueid: 'b9b68d6f-ff0c-4739-834a-f4cb4ceece76',
    msdyn_name: 'Issue 3 — Performance regression',
    msdyn_description: 'Integration tests show a 20% increase in response times after the latest deployment.',
    proj_issuecategory: 189330002,
    'proj_issuecategory@OData.Community.Display.V1.FormattedValue': 'Bug',
    proj_priority: 893460010,
    'proj_priority@OData.Community.Display.V1.FormattedValue': 'Critical',
    proj_state: 0,
    'proj_state@OData.Community.Display.V1.FormattedValue': 'Active',
    proj_duedate: '2025-07-31',
    '_msdyn_project_value': PROJECT_3,
    '_proj_assignedto_value': USER_3_ID,
    '_proj_assignedto_value@OData.Community.Display.V1.FormattedValue': 'User 3',
    createdon: '2025-07-15T00:00:00Z',
    statecode: 0,
  },
];

// ─── Project Changes ──────────────────────────────────────────────────────────
export const DEMO_CHANGES: ProjectChange[] = [
  {
    msdyn_projectchangeid: '0dc61b76-8884-47c5-8ba0-bf205ccfbbc2',
    msdyn_name: 'Change 1 — Scope addition',
    msdyn_description: 'Add reporting module to cover additional regulatory requirements identified during design review.',
    proj_changetype: 189330000,
    'proj_changetype@OData.Community.Display.V1.FormattedValue': 'Scope',
    proj_changeimpact: 189330001,
    'proj_changeimpact@OData.Community.Display.V1.FormattedValue': '(2) Medium',
    proj_changerisk: 189330001,
    'proj_changerisk@OData.Community.Display.V1.FormattedValue': 'Medium',
    proj_priority: 893460011,
    'proj_priority@OData.Community.Display.V1.FormattedValue': 'High',
    proj_approval: 189330002,
    'proj_approval@OData.Community.Display.V1.FormattedValue': '(3) Approved',
    proj_state: 0,
    'proj_state@OData.Community.Display.V1.FormattedValue': 'Active',
    proj_costimpact: 25000,
    proj_requesteddate: '2025-07-05',
    proj_plannedstartdate: '2025-07-20',
    proj_plannedduedate: '2025-08-31',
    '_msdyn_project_value': PROJECT_1,
    '_proj_requestedby_value': USER_1_ID,
    '_proj_requestedby_value@OData.Community.Display.V1.FormattedValue': 'User 1',
    createdon: '2025-07-05T00:00:00Z',
    statecode: 0,
  },
  {
    msdyn_projectchangeid: '1af5108b-4df4-43b9-8682-f2517c9b24a4',
    msdyn_name: 'Change 2 — Timeline extension',
    msdyn_description: 'Request to extend the project completion date by 6 weeks due to resource constraints.',
    proj_changetype: 189330001,
    'proj_changetype@OData.Community.Display.V1.FormattedValue': 'Schedule',
    proj_changeimpact: 189330000,
    'proj_changeimpact@OData.Community.Display.V1.FormattedValue': '(1) High',
    proj_changerisk: 189330000,
    'proj_changerisk@OData.Community.Display.V1.FormattedValue': 'High',
    proj_priority: 893460012,
    'proj_priority@OData.Community.Display.V1.FormattedValue': 'Medium',
    proj_approval: 189330001,
    'proj_approval@OData.Community.Display.V1.FormattedValue': '(2) Requested',
    proj_state: 0,
    'proj_state@OData.Community.Display.V1.FormattedValue': 'Active',
    proj_requesteddate: '2025-07-11',
    '_msdyn_project_value': PROJECT_2,
    '_proj_requestedby_value': USER_2_ID,
    '_proj_requestedby_value@OData.Community.Display.V1.FormattedValue': 'User 2',
    createdon: '2025-07-11T00:00:00Z',
    statecode: 0,
  },
];

// ─── Project Decisions ────────────────────────────────────────────────────────
export const DEMO_DECISIONS: ProjectDecision[] = [
  {
    pmo_projectdecisionid: '64b3801b-eef8-4169-8204-64b8fdfa6bb3',
    pmo_name: 'Decision 1 — Architecture approach',
    pmo_description: 'Approved use of microservices architecture for the integration layer.',
    pmo_decisiondate: '2025-07-08',
    pmo_status: 893460151,
    pmo_impact: 893460010,
    pmo_rationale: 'Microservices provides the scalability and maintainability required for future enhancements.',
    '_pmo_project_value': PROJECT_1,
    '_pmo_decisionowner_value': USER_1_ID,
    '_pmo_decisionowner_value@OData.Community.Display.V1.FormattedValue': 'User 1',
    createdon: '2025-07-08T00:00:00Z',
    statecode: 0,
  },
  {
    pmo_projectdecisionid: '339c6eb1-3ab7-437d-896c-8ba47be610f6',
    pmo_name: 'Decision 2 — Vendor selection',
    pmo_description: 'Proposed selection of Vendor A for the data processing component.',
    pmo_decisiondate: '2025-07-13',
    pmo_status: 893460150,
    pmo_rationale: 'Vendor A offers the best cost-to-capability ratio based on the evaluation scorecard.',
    '_pmo_project_value': PROJECT_2,
    '_pmo_decisionowner_value': USER_2_ID,
    '_pmo_decisionowner_value@OData.Community.Display.V1.FormattedValue': 'User 2',
    createdon: '2025-07-13T00:00:00Z',
    statecode: 0,
  },
  {
    pmo_projectdecisionid: '0e8722c0-b354-4bde-84d5-db13e18a4486',
    pmo_name: 'Decision 3 — Phase 2 scope',
    pmo_description: 'Approved proceeding with Phase 2 scope as defined in the project charter.',
    pmo_decisiondate: '2025-06-20',
    pmo_status: 893460151,
    pmo_impact: 893460011,
    pmo_rationale: 'Phase 2 scope aligns with the approved annual roadmap and budget allocation.',
    '_pmo_project_value': PROJECT_3,
    '_pmo_decisionowner_value': USER_3_ID,
    '_pmo_decisionowner_value@OData.Community.Display.V1.FormattedValue': 'User 3',
    createdon: '2025-06-20T00:00:00Z',
    statecode: 0,
  },
];

// ─── Status Reports ───────────────────────────────────────────────────────────
export const DEMO_STATUS_REPORTS: StatusReport[] = [
  {
    msdyn_projectstatusreportid: '4357690a-9615-4408-8d7e-6b8472078e84',
    msdyn_name: 'Status Report — Week 1',
    msdyn_accomplishedactivities: 'Integration pipeline completed with 98.7% message delivery rate.',
    msdyn_plannedactivities: 'Gate review scheduled for next week.',
    proj_reportingdate: '2025-07-07T00:00:00Z',
    '_msdyn_project_value': PROJECT_3,
    '_msdyn_project_value@OData.Community.Display.V1.FormattedValue': 'Project 3',
    createdon: '2025-07-07T08:00:00Z',
    statecode: 0,
  },
];

// ─── Teams ────────────────────────────────────────────────────────────────────
export const DEMO_TEAMS = [
  {
    teamid: TEAM_A_ID,
    name: 'Team 1',
    pmo_pmoteam: true,
    teamtype: 0,
  },
  {
    teamid: TEAM_B_ID,
    name: 'Team 2',
    pmo_pmoteam: true,
    teamtype: 0,
  },
  {
    teamid: TEAM_C_ID,
    name: 'Team 3',
    pmo_pmoteam: true,
    teamtype: 0,
  },
  {
    teamid: TEAM_D_ID,
    name: 'Team 4',
    pmo_pmoteam: true,
    teamtype: 0,
  },
  {
    teamid: TEAM_E_ID,
    name: 'Team 5',
    pmo_pmoteam: true,
    teamtype: 0,
  },
];

// ─── Intake Workflow Templates (pmo_gatesettemplates) ─────────────────────────
// Named to match WORKFLOW_TOGGLE_BY_NAME in GovernedIntakeWizard so the tile
// chooser shows both Program and Project cards with their correct toggle keys.
export const DEMO_GATE_SET_TEMPLATES: GateSetTemplate[] = [
  {
    pmo_gatesettemplateid: WORKFLOW_A,
    pmo_name: 'Standard Program Intake (5-Stage)',
    pmo_description: 'Four-stage intake review process for program requests.',
    pmo_workflowscope: 893460200, // IntakeWorkflow
    pmo_targetentitytype: 893460211, // Program
    pmo_isdefault: false,
    statecode: 0,
  },
  {
    pmo_gatesettemplateid: WORKFLOW_B,
    pmo_name: 'Standard Project Intake (5-Stage)',
    pmo_description: 'Six-stage intake review process for project requests.',
    pmo_workflowscope: 893460200, // IntakeWorkflow
    pmo_targetentitytype: 893460210, // Project
    pmo_isdefault: true,
    statecode: 0,
  },
];

// ─── Intake Workflow Stages (pmo_gatesetitems) ────────────────────────────────
export const DEMO_GATE_SET_ITEMS: GateSetItem[] = [
  // Standard Program Intake — 4 stages
  {
    pmo_gatesetitemid: 'b2b4b29f-52aa-4fdb-8297-0d0565b0eb06',
    pmo_name: 'Stage 1 — Program Identity',
    pmo_gatetype: 893460090,
    pmo_gateorder: 1,
    pmo_stagelabel: 'Program Identity',
    pmo_requiresapproval: false,
    '_pmo_gateset_value': WORKFLOW_A,
    statecode: 0,
  },
  {
    pmo_gatesetitemid: '64c32929-cbf1-483c-8560-3c2c7eb055e9',
    pmo_name: 'Stage 2 — Strategic Fit',
    pmo_gatetype: 893460091,
    pmo_gateorder: 2,
    pmo_stagelabel: 'Strategic Fit',
    pmo_requiresapproval: false,
    '_pmo_gateset_value': WORKFLOW_A,
    statecode: 0,
  },
  {
    pmo_gatesetitemid: 'c530e231-1ffa-46bb-8b9a-0f9325fe3b5e',
    pmo_name: 'Stage 3 — Governance Structure',
    pmo_gatetype: 893460092,
    pmo_gateorder: 3,
    pmo_stagelabel: 'Governance Structure',
    pmo_requiresapproval: false,
    '_pmo_gateset_value': WORKFLOW_A,
    statecode: 0,
  },
  {
    pmo_gatesetitemid: 'a4d7e812-3c19-4f5a-b6d0-1e8294c07f21',
    pmo_name: 'Stage 4 — Funding & Timeline',
    pmo_gatetype: 893460093,
    pmo_gateorder: 4,
    pmo_stagelabel: 'Funding & Timeline',
    pmo_requiresapproval: true,
    '_pmo_gateset_value': WORKFLOW_A,
    statecode: 0,
  },
  // Standard Project Intake — 6 stages
  {
    pmo_gatesetitemid: '6463599a-f8a9-459e-8a3b-6765fb337f33',
    pmo_name: 'Stage 1 — Request Basics',
    pmo_gatetype: 893460090,
    pmo_gateorder: 1,
    pmo_stagelabel: 'Request Basics',
    pmo_requiresapproval: false,
    '_pmo_gateset_value': WORKFLOW_B,
    statecode: 0,
  },
  {
    pmo_gatesetitemid: 'f1aa3da4-a487-4d01-852c-9e6ad9ba7eaa',
    pmo_name: 'Stage 2 — Scope & Context',
    pmo_gatetype: 893460091,
    pmo_gateorder: 2,
    pmo_stagelabel: 'Scope & Context',
    pmo_requiresapproval: false,
    '_pmo_gateset_value': WORKFLOW_B,
    statecode: 0,
  },
  {
    pmo_gatesetitemid: 'e3c91f05-7b42-4a8e-9d16-2f3085a14c67',
    pmo_name: 'Stage 3 — Business Justification',
    pmo_gatetype: 893460092,
    pmo_gateorder: 3,
    pmo_stagelabel: 'Business Justification',
    pmo_requiresapproval: false,
    '_pmo_gateset_value': WORKFLOW_B,
    statecode: 0,
  },
  {
    pmo_gatesetitemid: 'd8b20e34-5f61-4c97-8a03-7e4196b25d89',
    pmo_name: 'Stage 4 — Timeline & Budget',
    pmo_gatetype: 893460093,
    pmo_gateorder: 4,
    pmo_stagelabel: 'Timeline & Budget',
    pmo_requiresapproval: false,
    '_pmo_gateset_value': WORKFLOW_B,
    statecode: 0,
  },
  {
    pmo_gatesetitemid: 'c17a3d92-8e50-4b86-a715-9f3207d4e1b3',
    pmo_name: 'Stage 5 — Project Setup',
    pmo_gatetype: 893460094,
    pmo_gateorder: 5,
    pmo_stagelabel: 'Project Setup',
    pmo_requiresapproval: false,
    '_pmo_gateset_value': WORKFLOW_B,
    statecode: 0,
  },
  {
    pmo_gatesetitemid: 'b06f4e81-2d73-4595-c824-ae5318c63f90',
    pmo_name: 'Stage 6 — Review & Submit',
    pmo_gatetype: 893460095,
    pmo_gateorder: 6,
    pmo_stagelabel: 'Review & Submit',
    pmo_requiresapproval: true,
    '_pmo_gateset_value': WORKFLOW_B,
    statecode: 0,
  },
];

// --- System Users (fake roster - generic personas) ---
export const DEMO_SYSTEM_USERS = [
  { systemuserid: USER_1_ID, fullname: 'Alex Rivera',  firstname: 'Alex',   lastname: 'Rivera', internalemailaddress: 'alex.rivera@demo.example',  isdisabled: false },
  { systemuserid: USER_2_ID, fullname: 'Jordan Kim',   firstname: 'Jordan', lastname: 'Kim',    internalemailaddress: 'jordan.kim@demo.example',   isdisabled: false },
  { systemuserid: USER_3_ID, fullname: 'Sam Patel',    firstname: 'Sam',    lastname: 'Patel',  internalemailaddress: 'sam.patel@demo.example',    isdisabled: false },
  { systemuserid: USER_4_ID, fullname: 'Taylor Brooks', firstname: 'Taylor', lastname: 'Brooks', internalemailaddress: 'taylor.brooks@demo.example', isdisabled: false },
  { systemuserid: USER_5_ID, fullname: 'Morgan Lee',    firstname: 'Morgan', lastname: 'Lee',    internalemailaddress: 'morgan.lee@demo.example',    isdisabled: false },
];

// --- Team membership (systemuser <-> team N:N) ---
// Consumed by demoStore's anyResolver to answer teammembership_association/any().
export const DEMO_MEMBERSHIP = [
  // Primary leads
  { teamid: TEAM_A_ID, systemuserid: USER_1_ID },
  { teamid: TEAM_B_ID, systemuserid: USER_2_ID },
  { teamid: TEAM_C_ID, systemuserid: USER_3_ID },
  { teamid: TEAM_D_ID, systemuserid: USER_4_ID },
  { teamid: TEAM_E_ID, systemuserid: USER_5_ID },
  // Cross-memberships so every project's assignee picker has 2+ names.
  { teamid: TEAM_A_ID, systemuserid: USER_2_ID },
  { teamid: TEAM_A_ID, systemuserid: USER_5_ID },
  { teamid: TEAM_B_ID, systemuserid: USER_3_ID },
  { teamid: TEAM_B_ID, systemuserid: USER_4_ID },
  { teamid: TEAM_C_ID, systemuserid: USER_1_ID },
  { teamid: TEAM_D_ID, systemuserid: USER_2_ID },
  { teamid: TEAM_E_ID, systemuserid: USER_3_ID },
];

// --- Buckets (per project) ---
export const DEMO_BUCKETS = [
  { msdyn_projectbucketid: 'b7d29f88-e225-46e7-8a44-09c84aa71722', msdyn_name: 'Discovery',   msdyn_displayorder: 1, _msdyn_project_value: PROJECT_1, statecode: 0 },
  { msdyn_projectbucketid: '10d41d99-8163-4b4c-8335-d63f88c078d1', msdyn_name: 'Build',       msdyn_displayorder: 2, _msdyn_project_value: PROJECT_1, statecode: 0 },
  { msdyn_projectbucketid: 'c71f16af-91e0-4a19-86d6-53f3cbb06590', msdyn_name: 'Planning',    msdyn_displayorder: 1, _msdyn_project_value: PROJECT_2, statecode: 0 },
  { msdyn_projectbucketid: '1de7b82f-805d-43ce-83d6-07daa406c003', msdyn_name: 'Integration', msdyn_displayorder: 1, _msdyn_project_value: PROJECT_3, statecode: 0 },
];

// --- Tasks (per project + bucket) ---
export const DEMO_TASKS = [
  { msdyn_projecttaskid: '7158e4d4-b60b-4ca6-84db-e8677dd84f76', msdyn_subject: 'Requirements workshop',  msdyn_progress: 100, msdyn_effort: 24, msdyn_scheduledstart: '2025-07-01', msdyn_scheduledend: '2025-07-05', _msdyn_project_value: PROJECT_1, _msdyn_projectbucket_value: 'b7d29f88-e225-46e7-8a44-09c84aa71722', statecode: 0 },
  { msdyn_projecttaskid: '7785d516-9288-4341-89c6-17fd37bba5e9', msdyn_subject: 'Data model design',     msdyn_progress: 60,  msdyn_effort: 40, msdyn_scheduledstart: '2025-07-06', msdyn_scheduledend: '2025-07-20', _msdyn_project_value: PROJECT_1, _msdyn_projectbucket_value: 'b7d29f88-e225-46e7-8a44-09c84aa71722', statecode: 0 },
  { msdyn_projecttaskid: '225fef18-b8ef-4e37-80d7-b69332f315be', msdyn_subject: 'Pipeline build',        msdyn_progress: 20,  msdyn_effort: 80, msdyn_scheduledstart: '2025-07-21', msdyn_scheduledend: '2025-08-30', _msdyn_project_value: PROJECT_1, _msdyn_projectbucket_value: '10d41d99-8163-4b4c-8335-d63f88c078d1', statecode: 0 },
  { msdyn_projecttaskid: '22c20598-fa01-43ce-8c77-c9eb358a5fa2', msdyn_subject: 'Stakeholder alignment', msdyn_progress: 10,  msdyn_effort: 16, msdyn_scheduledstart: '2025-08-15', msdyn_scheduledend: '2025-08-22', _msdyn_project_value: PROJECT_2, _msdyn_projectbucket_value: 'c71f16af-91e0-4a19-86d6-53f3cbb06590', statecode: 0 },
];

// --- Project Collaborators (Individual mode) ---
export const DEMO_COLLABORATORS = [
  { pmo_projectcollaboratorid: '5f6d5c6f-b8d7-4839-883d-bd76a68d3763', pmo_name: 'Alex Rivera',   _pmo_project_value: PROJECT_1, _pmo_user_value: USER_1_ID, _pmo_viateam_value: TEAM_A_ID, statecode: 0 },
  { pmo_projectcollaboratorid: '4e5a30ab-1bb6-4cc6-8277-4d4fe86aef95', pmo_name: 'Sam Patel',     _pmo_project_value: PROJECT_1, _pmo_user_value: USER_3_ID, _pmo_viateam_value: null, statecode: 0 },
  { pmo_projectcollaboratorid: 'c3dd1234-2222-4000-8000-000000000001', pmo_name: 'Jordan Kim',    _pmo_project_value: PROJECT_2, _pmo_user_value: USER_2_ID, _pmo_viateam_value: TEAM_B_ID, statecode: 0 },
  { pmo_projectcollaboratorid: 'c3dd1234-2222-4000-8000-000000000002', pmo_name: 'Taylor Brooks', _pmo_project_value: PROJECT_3, _pmo_user_value: USER_4_ID, _pmo_viateam_value: TEAM_D_ID, statecode: 0 },
  { pmo_projectcollaboratorid: 'c3dd1234-2222-4000-8000-000000000003', pmo_name: 'Morgan Lee',    _pmo_project_value: PROJECT_4, _pmo_user_value: USER_5_ID, _pmo_viateam_value: TEAM_E_ID, statecode: 0 },
];

// --- Project Teams (Contributing) ---
export const DEMO_PROJECT_TEAMS = [
  // Primary team (role 1) for each project. useProjectScopedUsers builds the
  // assignee picker from these team memberships, so every project must have a row.
  { pmo_projectteamid: '24ae09be-cacd-4886-8686-adee4d7641ab', _pmo_project_value: PROJECT_1, _pmo_team_value: TEAM_A_ID, pmo_role: 1, statecode: 0 },
  { pmo_projectteamid: '9022c848-40ce-4ea0-81b1-cbb4be800030', _pmo_project_value: PROJECT_2, _pmo_team_value: TEAM_B_ID, pmo_role: 1, statecode: 0 },
  { pmo_projectteamid: 'c3dd1234-1111-4000-8000-000000000001', _pmo_project_value: PROJECT_3, _pmo_team_value: TEAM_C_ID, pmo_role: 1, statecode: 0 },
  { pmo_projectteamid: 'c3dd1234-1111-4000-8000-000000000002', _pmo_project_value: PROJECT_4, _pmo_team_value: TEAM_A_ID, pmo_role: 1, statecode: 0 },
  // Contributing teams
  { pmo_projectteamid: 'c3dd1234-1111-4000-8000-000000000003', _pmo_project_value: PROJECT_1, _pmo_team_value: TEAM_D_ID, pmo_role: 2, statecode: 0 },
  { pmo_projectteamid: 'c3dd1234-1111-4000-8000-000000000004', _pmo_project_value: PROJECT_2, _pmo_team_value: TEAM_E_ID, pmo_role: 2, statecode: 0 },
];

// --- Tracking labels ---
export const DEMO_TRACKINGS = [
  { pmo_trackingid: 'f7a666f9-6d5e-474e-8c9d-7c75b2020fec', pmo_label: 'Executive Priority', pmo_type: 'Project', pmo_recordid: PROJECT_1, statecode: 0 },
  { pmo_trackingid: '6ca7f4f1-a039-4423-8ab1-fb19621ee497', pmo_label: 'Compliance',         pmo_type: 'Project', pmo_recordid: PROJECT_1, statecode: 0 },
];

// --- Custom-source project twins (FULL FIDELITY) ---
// Demo runs on pmo.data_source='custom', so the app reads pmo_projects (not
// msdyn_projects). These carry every field the list grid + detail page render;
// choice LABELS are auto-synthesized by demoStore from the integer codes.
const CUSTOM_PROJECT_META: Record<string, Record<string, unknown>> = {
  [PROJECT_1]: {
    pmo_projectnumber: 'PROJ-00001', pmo_projectstatus: 508640001,
    pmo_stage: 192350002, pmo_state: 189330001, pmo_priority: 189330000,
    pmo_projecttype: 189330002, pmo_businessunit: 189330001,
    pmo_overallhealth: 189330000, pmo_efforthealth: 189330000, pmo_financialhealth: 189330000,
    pmo_schedulehealth: 189330001, pmo_issuehealth: 189330000,
    pmo_cfrcategory: 893460052, pmo_complexity: 893460062, pmo_strategicpriority: 893460070,
    pmo_scheduledstart: '2025-07-01', pmo_finish: '2025-09-30', pmo_scheduledcompletion: '2025-09-30',
    pmo_budget: 95000, pmo_actualcost: 58000, pmo_forecast: 92000, pmo_benefits: 240000, pmo_roi: 152,
    pmo_usenewresourcemodel: true, pmo_hoursperday: 8, pmo_hoursperweek: 40, pmo_dayspermonth: 20,
    _pmo_projectmanager_value: USER_1_ID, _pmo_program_value: PROGRAM_1,
    _pmo_primaryteam_value: TEAM_A_ID, _pmo_executivesponsor_value: USER_5_ID,
  },
  [PROJECT_2]: {
    pmo_projectnumber: 'PROJ-00002', pmo_projectstatus: 508640001,
    pmo_stage: 192350001, pmo_state: 189330001, pmo_priority: 189330001,
    pmo_projecttype: 189330001, pmo_businessunit: 189330000,
    pmo_overallhealth: 189330001, pmo_efforthealth: 189330001, pmo_financialhealth: 189330000,
    pmo_schedulehealth: 189330002, pmo_issuehealth: 189330001,
    pmo_cfrcategory: 893460053, pmo_complexity: 893460061, pmo_strategicpriority: 893460071,
    pmo_scheduledstart: '2025-08-15', pmo_finish: '2026-06-30', pmo_scheduledcompletion: '2026-06-30',
    pmo_budget: 720000, pmo_actualcost: 88000, pmo_forecast: 705000, pmo_benefits: 1500000, pmo_roi: 108,
    pmo_usenewresourcemodel: true, pmo_hoursperday: 8, pmo_hoursperweek: 40, pmo_dayspermonth: 20,
    _pmo_projectmanager_value: USER_2_ID, _pmo_program_value: PROGRAM_1,
    _pmo_primaryteam_value: TEAM_B_ID, _pmo_executivesponsor_value: USER_5_ID,
  },
  [PROJECT_3]: {
    pmo_projectnumber: 'PROJ-00003', pmo_projectstatus: 508640001,
    pmo_stage: 192350002, pmo_state: 189330001, pmo_priority: 189330000,
    pmo_projecttype: 189330002, pmo_businessunit: 189330001,
    pmo_overallhealth: 189330000, pmo_efforthealth: 189330000, pmo_financialhealth: 189330001,
    pmo_schedulehealth: 189330000, pmo_issuehealth: 189330000,
    pmo_cfrcategory: 893460050, pmo_complexity: 893460062, pmo_strategicpriority: 893460070,
    pmo_scheduledstart: '2025-03-01', pmo_finish: '2025-10-31', pmo_scheduledcompletion: '2025-10-31',
    pmo_budget: 485000, pmo_actualcost: 360000, pmo_forecast: 470000, pmo_benefits: 900000, pmo_roi: 86,
    pmo_usenewresourcemodel: true, pmo_hoursperday: 8, pmo_hoursperweek: 40, pmo_dayspermonth: 20,
    _pmo_projectmanager_value: USER_3_ID, _pmo_program_value: PROGRAM_2,
    _pmo_primaryteam_value: TEAM_C_ID, _pmo_executivesponsor_value: USER_1_ID,
  },
  [PROJECT_4]: {
    pmo_projectnumber: 'PROJ-00004', pmo_projectstatus: 508640004,
    pmo_stage: 192350003, pmo_state: 189330002, pmo_priority: 189330001,
    pmo_projecttype: 189330000, pmo_businessunit: 189330000,
    pmo_overallhealth: 189330000, pmo_efforthealth: 189330000, pmo_financialhealth: 189330000,
    pmo_schedulehealth: 189330000, pmo_issuehealth: 189330000,
    pmo_cfrcategory: 893460054, pmo_complexity: 893460060, pmo_strategicpriority: 893460072,
    pmo_scheduledstart: '2025-01-15', pmo_finish: '2025-06-30', pmo_scheduledcompletion: '2025-06-30',
    pmo_actualfinishdate: '2025-06-28',
    pmo_budget: 200000, pmo_actualcost: 195000, pmo_forecast: 195000, pmo_benefits: 520000, pmo_roi: 167,
    pmo_usenewresourcemodel: true, pmo_hoursperday: 8, pmo_hoursperweek: 40, pmo_dayspermonth: 20,
    _pmo_projectmanager_value: USER_1_ID, _pmo_program_value: PROGRAM_2,
    _pmo_primaryteam_value: TEAM_A_ID, _pmo_executivesponsor_value: USER_5_ID,
  },
};
export const DEMO_CUSTOM_PROJECTS = DEMO_PROJECTS.map((p) => ({
  pmo_projectid: p.msdyn_projectid,
  pmo_subject: p.msdyn_subject,
  pmo_name: p.msdyn_subject,
  pmo_description: p.msdyn_description,
  statecode: p.statecode,
  createdon: p.createdon,
  modifiedon: p.modifiedon,
  ...(CUSTOM_PROJECT_META[p.msdyn_projectid as string] ?? {}),
}));

// --- Custom-source bucket twins (same-GUID as msdyn buckets) ---
// Demo runs on pmo.data_source='custom' so the board reads pmo_buckets/pmo_tasks
// (fast direct OData) instead of the slow PSS msdyn_* staging path. Mirror the
// msdyn fixtures 1:1 by GUID so both sources render identical data.
export const DEMO_CUSTOM_BUCKETS = DEMO_BUCKETS.map((b) => ({
  pmo_bucketid:          b.msdyn_projectbucketid,
  pmo_name:              b.msdyn_name,
  pmo_orderinproject:    b.msdyn_displayorder,
  _pmo_projectref_value: b._msdyn_project_value,
  statecode:             b.statecode,
}));

let _demoTaskSeq = 0;
export const DEMO_CUSTOM_TASKS = DEMO_TASKS.map((t) => ({
  pmo_taskid:            t.msdyn_projecttaskid,
  pmo_tasknumber:        `TASK-${String(++_demoTaskSeq).padStart(5, '0')}`,
  pmo_subject:           t.msdyn_subject,
  pmo_progress:          t.msdyn_progress,
  pmo_effort:            t.msdyn_effort,
  pmo_startdate:         t.msdyn_scheduledstart,
  pmo_duedate:           t.msdyn_scheduledend,
  pmo_orderinbucket:     _demoTaskSeq,
  _pmo_projectref_value: t._msdyn_project_value,
  _pmo_bucket_value:     t._msdyn_projectbucket_value,
  statecode:             t.statecode,
}));

// --- Task assignments (assignee per task) ---
// pmo_taskassignment.pmo_user -> systemuser; demoStore synthesizes the
// _pmo_user_value FormattedValue from the user's fullname so the assignee
// name renders on the task tile without any backend.
export const DEMO_TASK_ASSIGNMENTS = [
  { pmo_taskassignmentid: 'b22ae30c-0cd0-41d7-8142-fd3111801774', pmo_name: 'Alex Rivera',   _pmo_task_value: '7158e4d4-b60b-4ca6-84db-e8677dd84f76', _pmo_user_value: USER_1_ID, _pmo_projectref_value: PROJECT_1, _pmo_projectteam_value: TEAM_A_ID, pmo_contributedhours: 24, statecode: 0 },
  { pmo_taskassignmentid: '73ff912d-aa31-46e8-865b-1c10074b623d', pmo_name: 'Jordan Kim',    _pmo_task_value: '7785d516-9288-4341-89c6-17fd37bba5e9', _pmo_user_value: USER_2_ID, _pmo_projectref_value: PROJECT_1, _pmo_projectteam_value: TEAM_A_ID, pmo_contributedhours: 20, statecode: 0 },
  { pmo_taskassignmentid: '639adebd-e365-41f1-8e72-d13c272a0e70', pmo_name: 'Sam Patel',     _pmo_task_value: '225fef18-b8ef-4e37-80d7-b69332f315be', _pmo_user_value: USER_3_ID, _pmo_projectref_value: PROJECT_1, _pmo_projectteam_value: TEAM_A_ID, pmo_contributedhours: 12, statecode: 0 },
  { pmo_taskassignmentid: 'ae64d666-b0f7-4713-8dcf-d41f93613e15', pmo_name: 'Taylor Brooks', _pmo_task_value: '22c20598-fa01-43ce-8c77-c9eb358a5fa2', _pmo_user_value: USER_4_ID, _pmo_projectref_value: PROJECT_2, _pmo_projectteam_value: TEAM_B_ID, pmo_contributedhours: 8,  statecode: 0 },
];

// --- Custom-source PROGRAM twins (app reads pmo_programs in custom mode) ---
const CUSTOM_PROGRAM_META: Record<string, Record<string, unknown>> = {
  [PROGRAM_1]: {
    pmo_programnumber: 'PROG-00001', pmo_programtype: 189330004, pmo_businessunit: 189330001,
    pmo_overallhealth: 189330000, pmo_state: 189330001,
    pmo_budget: 815000, pmo_benefit: 1740000, pmo_roi: 114,
    pmo_programstart: '2025-01-01', pmo_programdue: '2026-06-30',
    _pmo_manager_value: USER_1_ID,
  },
  [PROGRAM_2]: {
    pmo_programnumber: 'PROG-00002', pmo_programtype: 189330001, pmo_businessunit: 189330000,
    pmo_overallhealth: 189330001, pmo_state: 189330001,
    pmo_budget: 685000, pmo_benefit: 1420000, pmo_roi: 107,
    pmo_programstart: '2025-03-01', pmo_programdue: '2025-12-31',
    _pmo_manager_value: USER_3_ID,
  },
};
export const DEMO_CUSTOM_PROGRAMS = DEMO_PROGRAMS.map((pr) => ({
  pmo_programid: pr.msdyn_projectprogramid,
  pmo_name: pr.msdyn_name,
  pmo_description: pr.msdyn_description,
  statecode: pr.statecode,
  createdon: pr.createdon,
  ...(CUSTOM_PROGRAM_META[pr.msdyn_projectprogramid as string] ?? {}),
}));

// --- Custom-source MONITOR twins (risks/issues/changes) the custom path reads ---
export const DEMO_CUSTOM_RISKS = DEMO_RISKS.map((r, i) => ({
  pmo_projectriskid: r.msdyn_projectriskid,
  pmo_subject: r.msdyn_name,
  pmo_description: r.msdyn_description,
  pmo_probability: (r as unknown as Record<string, unknown>).proj_probability,
  pmo_impact: (r as unknown as Record<string, unknown>).proj_impact,
  pmo_exposure: (r as unknown as Record<string, unknown>).proj_exposure,
  pmo_category: [189330005, 189330001][i % 2],
  pmo_state: 189330001,
  _pmo_project_value: (r as unknown as Record<string, unknown>)._msdyn_project_value,
  _pmo_assignedto_value: [USER_3_ID, USER_2_ID][i % 2],
  createdon: r.createdon, statecode: 0,
}));
export const DEMO_CUSTOM_ISSUES = DEMO_ISSUES.map((it, i) => ({
  pmo_projectissueid: it.msdyn_projectissueid,
  pmo_subject: it.msdyn_name,
  pmo_description: it.msdyn_description,
  pmo_issuecategory: (it as unknown as Record<string, unknown>).proj_issuecategory,
  pmo_priority: [189330001, 189330002, 189330000][i % 3],
  pmo_state: 189330001,
  pmo_duedate: (it as unknown as Record<string, unknown>).proj_duedate,
  _pmo_project_value: (it as unknown as Record<string, unknown>)._msdyn_project_value,
  _pmo_assignedto_value: (it as unknown as Record<string, unknown>)._proj_assignedto_value,
  createdon: it.createdon, statecode: 0,
}));
export const DEMO_CUSTOM_CHANGES = DEMO_CHANGES.map((c, i) => ({
  pmo_projectchangeid: c.msdyn_projectchangeid,
  pmo_subject: c.msdyn_name,
  pmo_description: c.msdyn_description,
  pmo_changetype: (c as unknown as Record<string, unknown>).proj_changetype,
  pmo_changeimpact: (c as unknown as Record<string, unknown>).proj_changeimpact,
  pmo_priority: [189330001, 189330002][i % 2],
  pmo_approval: [189330002, 189330001][i % 2],
  pmo_state: 189330001,
  pmo_costimpact: (c as unknown as Record<string, unknown>).proj_costimpact,
  _pmo_project_value: (c as unknown as Record<string, unknown>)._msdyn_project_value,
  _pmo_requestedby_value: (c as unknown as Record<string, unknown>)._proj_requestedby_value,
  createdon: c.createdon, statecode: 0,
}));
export const DEMO_CUSTOM_STATUS_REPORTS = DEMO_STATUS_REPORTS.map((sr) => ({
  pmo_projectstatusreportid: sr.msdyn_projectstatusreportid,
  pmo_name: sr.msdyn_name,
  pmo_accomplishedactivities: sr.msdyn_accomplishedactivities,
  pmo_plannedactivities: sr.msdyn_plannedactivities,
  pmo_reportingdate: (sr as unknown as Record<string, unknown>).proj_reportingdate,
  _pmo_project_value: (sr as unknown as Record<string, unknown>)._msdyn_project_value,
  _pmo_submitter_value: USER_3_ID,
  createdon: sr.createdon, statecode: 0,
}));

// --- Project GATES (per-project lifecycle governance) ---
export const DEMO_PROJECT_GATES = [
  { pmo_projectgateid: 'de300000-0000-4000-8000-0000000000a1', pmo_name: 'Initiation Gate', pmo_gatetype: 893460090, pmo_gateorder: 0, pmo_status: 893460096, _pmo_project_value: PROJECT_1, _pmo_owner_value: USER_1_ID, statecode: 0 },
  { pmo_projectgateid: 'de300000-0000-4000-8000-0000000000a2', pmo_name: 'Planning Gate',   pmo_gatetype: 893460091, pmo_gateorder: 1, pmo_status: 893460096, _pmo_project_value: PROJECT_1, _pmo_owner_value: USER_1_ID, statecode: 0 },
  { pmo_projectgateid: 'de300000-0000-4000-8000-0000000000a3', pmo_name: 'Execution Gate',  pmo_gatetype: 893460092, pmo_gateorder: 2, pmo_status: 893460095, _pmo_project_value: PROJECT_1, _pmo_owner_value: USER_1_ID, statecode: 0 },
  { pmo_projectgateid: 'de300000-0000-4000-8000-0000000000a4', pmo_name: 'Closeout Gate',   pmo_gatetype: 893460093, pmo_gateorder: 3, pmo_status: 893460094, _pmo_project_value: PROJECT_1, _pmo_owner_value: USER_1_ID, statecode: 0 },
];

// --- Notifications (targeting the demo admin user) ---
export const DEMO_NOTIFICATIONS = [
  { pmo_notificationid: 'de300000-0000-4000-8000-0000000000b1', pmo_title: 'Gate review due', pmo_body: 'Execution Gate on Project 1 is awaiting your review.', pmo_category: 893460130, pmo_isread: false, pmo_actionurl: '/projects/' + PROJECT_1 + '?tab=govern', _pmo_targetuser_value: USER_1_ID, _pmo_project_value: PROJECT_1, createdon: '2025-07-14T09:00:00Z', statecode: 0 },
  { pmo_notificationid: 'de300000-0000-4000-8000-0000000000b2', pmo_title: 'Task assigned to you', pmo_body: 'You were assigned Pipeline build on Project 1.', pmo_category: 893460136, pmo_isread: false, pmo_actionurl: '/projects/' + PROJECT_1 + '?tab=plan', _pmo_targetuser_value: USER_1_ID, _pmo_project_value: PROJECT_1, createdon: '2025-07-13T15:30:00Z', statecode: 0 },
  { pmo_notificationid: 'de300000-0000-4000-8000-0000000000b3', pmo_title: 'Status report submitted', pmo_body: 'A new status report was submitted for Project 3.', pmo_category: 893460135, pmo_isread: true, pmo_actionurl: '/projects/' + PROJECT_3 + '?tab=status', _pmo_targetuser_value: USER_1_ID, _pmo_project_value: PROJECT_3, createdon: '2025-07-07T08:05:00Z', statecode: 0 },
];

// --- User Feedback (bug/enhancement tickets) ---
export const DEMO_USER_FEEDBACK = [
  { pmo_userfeedbackid: 'de300000-0000-4000-8000-0000000000c1', pmo_title: 'Board tiles slow to load with 200+ tasks', pmo_description: 'The Plan board takes several seconds to render on large projects.', pmo_feedbacktype: 893460000, pmo_status: 893460011, pmo_priority: 893460011, _createdby_value: USER_2_ID, createdon: '2025-07-09T10:00:00Z', statecode: 0 },
  { pmo_userfeedbackid: 'de300000-0000-4000-8000-0000000000c2', pmo_title: 'Add export to Excel on the risk register', pmo_description: 'Would like to export risks/issues to a spreadsheet for offline review.', pmo_feedbacktype: 893460001, pmo_status: 893460012, pmo_priority: 893460012, _createdby_value: USER_3_ID, createdon: '2025-07-06T14:20:00Z', statecode: 0 },
  { pmo_userfeedbackid: 'de300000-0000-4000-8000-0000000000c3', pmo_title: 'Gate approval email has a broken link', pmo_description: 'The link in the gate-approval notification 404s.', pmo_feedbacktype: 893460000, pmo_status: 893460014, pmo_priority: 893460011, pmo_responsecomments: 'Fixed in the 2.18 release.', pmo_dateresolved: '2025-07-11T00:00:00Z', _createdby_value: USER_4_ID, createdon: '2025-07-02T09:15:00Z', statecode: 0 },
];

// --- Telemetry events: Change History (EntityChange/AdminChange) + Error Log (AppError) ---
export const DEMO_TELEMETRY_EVENTS = [
  { pmo_telemetryeventid: 'de300000-0000-4000-8000-0000000000d1', pmo_eventtype: 'EntityChange', pmo_source: 'app', createdon: '2025-07-14T08:00:00Z', _createdby_value: USER_1_ID, '_createdby_value@OData.Community.Display.V1.FormattedValue': 'Alex Rivera', pmo_payload: JSON.stringify({ entityType: 'project', entityId: PROJECT_1, entityName: 'Project 1', action: 'update', changes: [{ kind: 'field', field: 'proj_overallhealth', label: 'Overall health', oldValue: 'At Risk', newValue: 'On Track' }] }), statecode: 0 },
  { pmo_telemetryeventid: 'de300000-0000-4000-8000-0000000000d2', pmo_eventtype: 'EntityChange', pmo_source: 'app', createdon: '2025-07-13T15:30:00Z', _createdby_value: USER_2_ID, '_createdby_value@OData.Community.Display.V1.FormattedValue': 'Jordan Kim', pmo_payload: JSON.stringify({ entityType: 'task', entityId: '225fef18-b8ef-4e37-80d7-b69332f315be', entityName: 'Pipeline build', action: 'update', parentProjectId: PROJECT_1, parentProjectName: 'Project 1', changes: [{ kind: 'field', field: 'pmo_progress', label: 'Progress', oldValue: '10', newValue: '20' }] }), statecode: 0 },
  { pmo_telemetryeventid: 'de300000-0000-4000-8000-0000000000d3', pmo_eventtype: 'EntityChange', pmo_source: 'app', createdon: '2025-07-12T11:00:00Z', _createdby_value: USER_3_ID, '_createdby_value@OData.Community.Display.V1.FormattedValue': 'Sam Patel', pmo_payload: JSON.stringify({ entityType: 'risk', entityId: DEMO_RISKS[0].msdyn_projectriskid, entityName: 'Risk 1 - Vendor dependency', action: 'create', parentProjectId: PROJECT_3, parentProjectName: 'Project 3' }), statecode: 0 },
  { pmo_telemetryeventid: 'de300000-0000-4000-8000-0000000000d4', pmo_eventtype: 'AdminChange', pmo_source: 'admin', createdon: '2025-07-10T09:45:00Z', _createdby_value: USER_1_ID, '_createdby_value@OData.Community.Display.V1.FormattedValue': 'Alex Rivera', pmo_payload: JSON.stringify({ settingKey: 'pmo.people_source', oldValue: 'systemuser', newValue: 'o365' }), statecode: 0 },
  { pmo_telemetryeventid: 'de300000-0000-4000-8000-0000000000d5', pmo_eventtype: 'AppError', pmo_source: 'app', pmo_severity: 893460142, createdon: '2025-07-14T12:15:00Z', _createdby_value: USER_2_ID, '_createdby_value@OData.Community.Display.V1.FormattedValue': 'Jordan Kim', pmo_payload: JSON.stringify({ message: 'Failed to save task: timeout', route: '/projects/' + PROJECT_1, detail: 'The operation timed out after 30s.' }), statecode: 0 },
  { pmo_telemetryeventid: 'de300000-0000-4000-8000-0000000000d6', pmo_eventtype: 'AppError', pmo_source: 'app', pmo_severity: 893460141, createdon: '2025-07-11T16:40:00Z', _createdby_value: USER_3_ID, '_createdby_value@OData.Community.Display.V1.FormattedValue': 'Sam Patel', pmo_payload: JSON.stringify({ message: 'Document upload retried', route: '/projects/' + PROJECT_3, detail: 'SharePoint upload succeeded on retry.' }), statecode: 0 },
];

// --- App settings: run demo on the fast custom pmo_* data source ---
export const DEMO_APP_SETTINGS = [
  { pmo_appsettingid: 'ba9818b8-8770-4978-83af-251e07191da0', pmo_key: 'pmo.data_source', pmo_value: 'custom', statecode: 0 },
  { pmo_appsettingid: '19ff76bf-2a1a-4ce9-8940-752e46060938', pmo_key: 'pmo.file_source', pmo_value: 'sharepoint', statecode: 0 },
  { pmo_appsettingid: 'c3e8a12f-5d49-4b7e-9f01-6a2384d05c71', pmo_key: 'pmo.feature_toggles_json', pmo_value: JSON.stringify({ 'intake.bypassApproval': true }), statecode: 0 },
];

// ─── Registry: entity set name → fixture array ────────────────────────────────
export const DEMO_FIXTURES: Record<string, unknown[]> = {
  pmo_projectrequests:        DEMO_PROJECT_REQUESTS,
  msdyn_projects:             DEMO_PROJECTS,
  msdyn_projectprograms:      DEMO_PROGRAMS,
  msdyn_projectrisks:         DEMO_RISKS,
  msdyn_projectissues:        DEMO_ISSUES,
  msdyn_projectchanges:       DEMO_CHANGES,
  msdyn_projectstatusreports: DEMO_STATUS_REPORTS,
  msdyn_projectbuckets:       DEMO_BUCKETS,
  msdyn_projecttasks:         DEMO_TASKS,
  pmo_projects:               DEMO_CUSTOM_PROJECTS,
  pmo_programs:               DEMO_CUSTOM_PROGRAMS,
  pmo_projectrisks:           DEMO_CUSTOM_RISKS,
  pmo_projectissues:          DEMO_CUSTOM_ISSUES,
  pmo_projectchanges:         DEMO_CUSTOM_CHANGES,
  pmo_projectstatusreports:   DEMO_CUSTOM_STATUS_REPORTS,
  pmo_buckets:                DEMO_CUSTOM_BUCKETS,
  pmo_tasks:                  DEMO_CUSTOM_TASKS,
  pmo_taskassignments:        DEMO_TASK_ASSIGNMENTS,
  pmo_projectdecisions:       DEMO_DECISIONS,
  pmo_projectgates:           DEMO_PROJECT_GATES,
  pmo_projectteams:           DEMO_PROJECT_TEAMS,
  pmo_projectcollaborators:   DEMO_COLLABORATORS,
  pmo_trackings:              DEMO_TRACKINGS,
  pmo_gatesettemplates:       DEMO_GATE_SET_TEMPLATES,
  pmo_gatesetitems:           DEMO_GATE_SET_ITEMS,
  teams:                      DEMO_TEAMS,
  systemusers:                DEMO_SYSTEM_USERS,
  _membership:                DEMO_MEMBERSHIP,
  pmo_appsettings:            DEMO_APP_SETTINGS,
  pmo_userfeedbacks:          DEMO_USER_FEEDBACK,
  pmo_notifications:          DEMO_NOTIFICATIONS,
  pmo_telemetryevents:        DEMO_TELEMETRY_EVENTS,
};
