import * as dv from '../lib/dataverseClient';
import { touchCustomProject, touchProjectFromChild } from './customProjects.api';
import { projectMatch, PROJECT_VALUE_SELECT } from '../lib/projectLookupRef';
import { CUSTOM_PROJECT_VALUE, PSS_PROJECT_VALUE, projectIdFromBindPayload } from '../lib/projectLookupRef';
import { ENTITY_SETS } from '../lib/constants';
import type { ProjectMeetingLink, ProjectMeetingLinkCreate, ProjectMeetingLinkUpdate } from '../models/projectMeetingLink.model';

const SET = ENTITY_SETS.projectMeetingLink;
const FIELDS: string[] = [
  'pmo_projectmeetinglinkid', 'pmo_name', 'pmo_meetingsubject', 'pmo_meetingdatetime',
  'pmo_meetingurl', 'pmo_notes', 'statecode', 'createdon',
  '_pmo_program_value',
  ...PROJECT_VALUE_SELECT,
];

export async function listProjectMeetingLinks(projectId: string): Promise<ProjectMeetingLink[]> {
  return dv.list<ProjectMeetingLink>(SET, {
    $select: FIELDS,
    $filter: `${projectMatch(projectId)} and statecode eq 0`,
    $orderby: 'pmo_meetingdatetime desc',
  });
}

export async function createProjectMeetingLink(payload: ProjectMeetingLinkCreate): Promise<ProjectMeetingLink> {
  void touchCustomProject(projectIdFromBindPayload(payload as unknown as Record<string, unknown>) ?? '');
  return dv.create<ProjectMeetingLink>(SET, payload);
}

export async function updateProjectMeetingLink(id: string, payload: ProjectMeetingLinkUpdate): Promise<void> {
  await dv.update(SET, id, payload);
  void touchProjectFromChild(SET, id, CUSTOM_PROJECT_VALUE, PSS_PROJECT_VALUE);
}

export async function deactivateProjectMeetingLink(id: string): Promise<void> {
  void touchProjectFromChild(SET, id, CUSTOM_PROJECT_VALUE, PSS_PROJECT_VALUE);
  await dv.deactivate(SET, id);
}
