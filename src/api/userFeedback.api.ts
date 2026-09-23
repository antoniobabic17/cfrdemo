import * as dv from '../lib/dataverseClient';
import type { UserFeedback, UserFeedbackCreate } from '../models/userFeedback.model';

const SET = 'pmo_userfeedbacks';

const BASE_SELECT: string[] = [
  'pmo_userfeedbackid',
  'pmo_title',
  'pmo_description',
  'pmo_feedbacktype',
  'pmo_status',
  'pmo_priority',
  'pmo_responsecomments',
  'pmo_sourcecontext',
  'pmo_dateresolved',
  '_createdby_value',
  '_ownerid_value',
  '_pmo_assignedto_value',
  'createdon',
  'statecode',
];

export async function listUserFeedback(extraSelect: string[] = []): Promise<UserFeedback[]> {
  return dv.list<UserFeedback>(SET, {
    $select: dv.boundedSelect(BASE_SELECT, extraSelect),
    $orderby: 'createdon desc',
  });
}

export async function getUserFeedback(id: string): Promise<UserFeedback> {
  return dv.get<UserFeedback>(SET, id, BASE_SELECT);
}

export async function createUserFeedback(payload: UserFeedbackCreate): Promise<UserFeedback> {
  return dv.create<UserFeedback>(SET, payload);
}

export async function updateUserFeedback(id: string, payload: Partial<UserFeedbackCreate> & { pmo_responsecomments?: string; pmo_dateresolved?: string | null; 'ownerid@odata.bind'?: string; 'pmo_AssignedTo@odata.bind'?: string | null }): Promise<void> {
  return dv.update(SET, id, payload);
}

/** Hard-delete a user-feedback row. Admin-only — caller must gate. */
export async function deleteUserFeedback(id: string): Promise<void> {
  return dv.remove(SET, id);
}
