import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import type { Notification, NotificationCreate } from '../models/notification.model';

const SET = ENTITY_SETS.notification;
const FIELDS: (keyof Notification)[] = [
  'pmo_notificationid', 'pmo_title', 'pmo_body', 'pmo_category',
  'pmo_isread', 'pmo_actionurl', 'statecode', 'createdon',
  '_pmo_targetuser_value', '_pmo_project_value', '_pmo_program_value',
  '_createdby_value',
];

export async function listNotifications(userId: string): Promise<Notification[]> {
  // Guard: caller must pass a real systemuserid GUID. In Power Apps Code Apps
  // the synchronous getCurrentUserId() returns 'anonymous' before the async
  // resolver lands; querying with that (or any non-GUID) builds an invalid
  // OData filter (`_pmo_targetuser_value eq anonymous`) that Dataverse rejects
  // as a bad property reference. Return empty rather than 400.
  const id = (userId ?? '').replace(/[{}]/g, '').trim().toLowerCase();
  const isGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
  if (!isGuid) return [];
  return dv.list<Notification>(SET, {
    $select: FIELDS,
    $filter: `_pmo_targetuser_value eq ${id} and statecode eq 0`,
    $orderby: 'createdon desc',
    $top: 50,
  });
}

/**
 * Admin "see all" read: every active notification in the environment, regardless
 * of target user or category. Adds the target-user's display name via the OData
 * formatted-value annotation so the UI can show who each one was for. Caller MUST
 * gate this to admins.
 */
export async function listAllNotifications(): Promise<Notification[]> {
  return dv.list<Notification>(SET, {
    $select: FIELDS,
    $filter: 'statecode eq 0',
    $orderby: 'createdon desc',
    $top: 200,
  });
}

export async function createNotification(payload: NotificationCreate): Promise<Notification> {
  return dv.create<Notification>(SET, payload);
}

export async function markAsRead(id: string): Promise<void> {
  return dv.update(SET, id, { pmo_isread: true });
}

export async function dismissNotification(id: string): Promise<void> {
  return dv.deactivate(SET, id);
}

/** Hard-delete a notification row. Admin-only in the UI (Intake Queue). */
export async function deleteNotification(id: string): Promise<void> {
  return dv.remove(SET, id);
}
