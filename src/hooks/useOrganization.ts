import { useQuery } from '@tanstack/react-query';
import { fetchOrganizationId } from '../api/organization.api';
import { PLANNER_BASE, PLANNER_BOARD_SUFFIX } from '../lib/constants';
import { useTenantId } from '../providers/ConfigurationProvider';

export function useOrganizationId() {
  return useQuery({
    queryKey: ['organizationId'],
    queryFn: fetchOrganizationId,
    staleTime: Infinity, // org ID never changes within a session
  });
}

/** Returns a fully-constructed Planner board URL, or null if not yet ready.
 *  Pass the project's msdyn_projectid — the Planner plan GUID equals the project GUID. */
export function usePlannerUrl(planId: string | null | undefined): string | null {
  const { data: orgId } = useOrganizationId();
  const tenantId = useTenantId();
  if (!planId || !orgId) return null;
  return `${PLANNER_BASE}${planId}/org/${orgId}${PLANNER_BOARD_SUFFIX}?tid=${tenantId}`;
}
