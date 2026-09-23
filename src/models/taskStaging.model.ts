/**
 * pmo_taskstaging — staging row shape.
 *
 * Reads from Dataverse OData. Writes are shaped in stagingClient.ts.
 * Choice values live in constants.ts (STAGING_OPERATION / STAGING_ENTITY_TYPE /
 * STAGING_SYNC_STATUS).
 */
import type { StagingOperation, StagingEntityType, StagingSyncStatus } from '../lib/constants';

export interface TaskStagingRow {
  pmo_taskstagingid: string;
  pmo_operation: StagingOperation;
  pmo_entitytype: StagingEntityType;
  /** Target record GUID. Client-generated for creates so downstream ops in the
   *  same OperationSet can reference it (msdyn_projecttaskid, msdyn_projectbucketid,
   *  msdyn_projecttaskdependencyid, msdyn_resourceassignmentid). */
  pmo_targetid: string;
  /** Project scope (batching key + ActivityFeed filter). */
  '_pmo_project_value'?: string;
  '_pmo_project_value@OData.Community.Display.V1.FormattedValue'?: string;
  /** JSON blob mirroring the shape passed into the corresponding schedulingClient
   *  helper (ScheduleTaskCreate / ScheduleTaskUpdate / ScheduleBucketCreate / ...). */
  pmo_payload: string;
  pmo_syncstatus: StagingSyncStatus;
  pmo_syncerror?: string;
  pmo_scheduleapicode?: string;
  pmo_opsetid?: string;
  pmo_attempts?: number;
  /** Monotonic per-project order (drain applies in this order). */
  pmo_sequence?: number;
  /** Optional self-lookup: this row must wait for the referenced staging row
   *  to become Synced before it drains (dependency ordering). */
  '_pmo_dependsonstagingid_value'?: string;
  ownerid?: string;
  '_ownerid_value@OData.Community.Display.V1.FormattedValue'?: string;
  createdon?: string;
  modifiedon?: string;
  statecode?: number;
}
