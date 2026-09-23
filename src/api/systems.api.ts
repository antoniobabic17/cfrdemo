import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';

const SET = ENTITY_SETS.crSystem;

/**
 * The cr87a_System table is a pre-existing reference catalog owned by an
 * upstream solution (Nexus RCM). It is not shipped by this repo. Its real
 * primary-name column is `cr87a_systemname` (NOT `cr87a_name` — that
 * convention does not apply to this entity).
 *
 * Per-env reality (as of 2026-05):
 *   - Nexus-PROD : 23 active rows, entity exists.
 *   - Nexus-DEV  : entity does not exist at all (returns 404 from the
 *                  OData endpoint).
 *
 * To keep the intake wizard usable in DEV (and any future env that hasn't
 * imported the upstream catalog), `listSystems()` swallows "table missing"
 * errors and returns []. Consumers already render an empty searchable
 * dropdown gracefully.
 */
export interface CrSystem {
  cr87a_systemid: string;
  cr87a_systemname: string;
}

/** True when the error from Dataverse indicates the entity set/table does
 *  not exist in the target environment (vs. a transient/auth failure). */
function isEntityMissingError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  return (
    msg.includes("resource not found for the segment") ||
    msg.includes("does not exist") ||
    msg.includes('entity with id') ||
    msg.includes("could not find a property") || // wrong column name on a real table
    msg.includes('404')
  );
}

export async function listSystems(): Promise<CrSystem[]> {
  try {
    return await dv.list<CrSystem>(SET, {
      $select: ['cr87a_systemid', 'cr87a_systemname'],
      $filter: 'statecode eq 0',
      $orderby: 'cr87a_systemname asc',
    });
  } catch (err) {
    if (isEntityMissingError(err)) {
      // Upstream catalog not deployed in this env — fall back to empty list
      // so the intake wizard still renders. The Affected System dropdown
      // simply has no options to choose from, which matches reality.
      // eslint-disable-next-line no-console
      console.warn('[systems.api] cr87a_systems unavailable in this env:', err);
      return [];
    }
    throw err;
  }
}
