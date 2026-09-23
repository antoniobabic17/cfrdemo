import { getOrganizationId } from '../lib/dataverseClient';

let cachedOrgId: string | null = null;

/** Returns the Dataverse organization ID, fetching and caching it on first call. */
export async function fetchOrganizationId(): Promise<string> {
  if (cachedOrgId) return cachedOrgId;
  cachedOrgId = await getOrganizationId();
  return cachedOrgId;
}
