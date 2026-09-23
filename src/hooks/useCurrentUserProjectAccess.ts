/**
 * useCurrentUserProjectAccess -- fetch signals about whether the current
 * user is provisioned for Project for the Web (Planner / P4W).
 *
 * Why this exists
 * ---------------
 * When a user tries to create a bucket or task and Dataverse rejects with
 * a privilege error, the app can't easily distinguish these root causes:
 *   1. Missing Dataverse role (fixable by admin)
 *   2. Missing P4W license      (fixable by IT: assign Project Plan 3+)
 *   3. Stale session cache      (fixable by user: sign out/in)
 *
 * This hook aggregates the signals we CAN read from Dataverse and returns
 * a summary the AppShell banner + error messages can use to point users
 * at the right fix.
 *
 * Signals collected
 * -----------------
 *   isLicensed          -- systemuser.islicensed (Microsoft flag)
 *   isDisabled          -- systemuser.isdisabled (should be false)
 *   accessMode          -- systemuser.accessmode (0 = Read-Write)
 *   hasBookableResource -- true iff a bookableresource row exists for the
 *                          user with resourcetype = User (P4W creates one
 *                          on license assignment)
 *   effectiveState:
 *     'ready'           -- looks good, expect writes to succeed
 *     'no_license'      -- islicensed=false, IT needs to assign a license
 *     'no_bookable_resource' -- licensed but no BR yet (P4W provisioning
 *                          might not have completed)
 *     'disabled'        -- user account is disabled
 *     'restricted'      -- accessmode != 0 (Admin / Non-interactive /
 *                          Read-only user; can't create/edit through app)
 *     'unknown'         -- still loading or query failed
 */
import { useQuery } from '@tanstack/react-query';
import { useCurrentUserId } from './useCurrentUserId';
import { isDemoModeActive } from '../lib/demoMode';
import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import { useDataSource, usesCustomTables } from '../lib/taskSource';

export type UserProjectAccessState =
  | 'ready'
  | 'no_license'
  | 'no_bookable_resource'
  | 'disabled'
  | 'restricted'
  | 'unknown';

export interface UserProjectAccess {
  state: UserProjectAccessState;
  isLicensed: boolean;
  isDisabled: boolean;
  accessMode: number;
  hasBookableResource: boolean;
  /** True when at least one signal indicates a problem the user or admin should act on. */
  hasWarning: boolean;
  /** Short user-facing string describing the current state. */
  message: string;
  /** Suggested next-step copy. */
  hint: string;
  loading: boolean;
}

interface UserRow {
  systemuserid: string;
  islicensed?: boolean;
  isdisabled?: boolean;
  accessmode?: number;
  setupuser?: boolean;
}

interface BookableResourceRow {
  bookableresourceid: string;
  resourcetype?: number;
  statecode?: number;
}

const NON_INTERACTIVE_ACCESS_MODES = new Set([1, 3, 4, 5]);

function summarize(u: UserRow, brCount: number): UserProjectAccess {
  const isLicensed = !!u.islicensed;
  const isDisabled = !!u.isdisabled;
  const accessMode = Number(u.accessmode ?? 0);
  const hasBookableResource = brCount > 0;

  let state: UserProjectAccessState = 'ready';
  let message = 'Your account looks correctly provisioned for Project for the Web.';
  let hint = '';

  if (isDisabled) {
    state = 'disabled';
    message = 'Your Dataverse user account is disabled.';
    hint = 'Contact your IT admin to re-enable your account.';
  } else if (NON_INTERACTIVE_ACCESS_MODES.has(accessMode)) {
    state = 'restricted';
    message = 'Your Dataverse access mode restricts create/edit through this app.';
    hint = 'Contact your IT admin to switch your account to Read-Write access mode.';
  } else if (!isLicensed) {
    state = 'no_license';
    message = "Your Microsoft account isn't licensed for Project for the Web.";
    hint = 'Ask your IT admin to assign a Project Plan 3 or Project Plan 5 license, then sign out and back in.';
  } else if (!hasBookableResource) {
    state = 'no_bookable_resource';
    message = 'Your account is licensed but P4W provisioning is incomplete.';
    hint = 'Try signing out and back in. If the issue persists, ask your IT admin to verify your Project license assignment.';
  }

  const hasWarning = state !== 'ready';
  return {
    state,
    isLicensed,
    isDisabled,
    accessMode,
    hasBookableResource,
    hasWarning,
    message,
    hint,
    loading: false,
  };
}

export function useCurrentUserProjectAccess(): UserProjectAccess {
  const userId = useCurrentUserId();
  const dataSource = useDataSource();
  // When the app runs on the custom pmo_* tables, project/task/program reads
  // and writes go direct via OData with no PSS / Project-for-the-Web
  // involvement. A P4W license or bookable resource is irrelevant in that
  // mode, so the provisioning warning is a false alarm — stay silent and skip
  // the query entirely.
  const customTables = usesCustomTables(dataSource);
  const query = useQuery({
    queryKey: userId ? ['currentUserProjectAccess', userId] as const : ['currentUserProjectAccess', 'pending'] as const,
    enabled: !!userId && !isDemoModeActive() && !customTables,
    staleTime: 10 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      if (!userId) return null;
      const user = await dv.get<UserRow>(
        ENTITY_SETS.systemUser,
        userId,
        ['systemuserid', 'islicensed', 'isdisabled', 'accessmode', 'setupuser'],
      );
      const resources = await dv.list<BookableResourceRow>('bookableresources', {
        $select: ['bookableresourceid', 'resourcetype', 'statecode'],
        $filter: `_userid_value eq '${userId}' and statecode eq 0`,
        $top: 5,
      });
      // Only count bookable resources of type User (3) or GenericResource (1)
      // -- Contact / Equipment / Facility don't imply the user has P4W.
      const brCount = resources.filter((r) => r.resourcetype === 3 || r.resourcetype == null || r.resourcetype === 1).length;
      return summarize(user, brCount);
    },
  });

  if (customTables) {
    return {
      state: 'ready',
      isLicensed: false,
      isDisabled: false,
      accessMode: 0,
      hasBookableResource: false,
      hasWarning: false,
      message: 'Custom tables mode — Project for the Web licensing does not apply.',
      hint: '',
      loading: false,
    };
  }

  if (query.data) return query.data;
  return {
    state: 'unknown',
    isLicensed: false,
    isDisabled: false,
    accessMode: 0,
    hasBookableResource: false,
    hasWarning: false,
    message: 'Checking Project for the Web access…',
    hint: '',
    loading: true,
  };
}
