/**
 * Option-C Phase 4 admin action wrapper for the pmo_EtlBulkCatchup Custom API.
 *
 * Re-runs the pmo -> msdyn reverse ETL over pmo_task / pmo_bucket /
 * pmo_taskdependency rows modified in a date range, backfilling anything the
 * live PmoTaskEtlPlugin skipped while pmo.etl_enabled was false. Idempotent.
 *
 * See solution/plugins/PmoTaskEtlPlugin/EtlBulkCatchupApi.cs and
 * docs/pss-decoupling-c-design.md.
 */

import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';

/** Parsed shape of the CustomAPI's JSON `Result` string. */
export interface EtlCatchupResult {
  pushed: number;
  failed: number;
  byEntity: Record<string, { pushed: number; failed: number }>;
}

export interface EtlCatchupParams {
  /** ISO 8601 lower bound (inclusive) on modifiedon. */
  fromDate: string;
  /** ISO 8601 upper bound (inclusive) on modifiedon. */
  toDate: string;
  includeBuckets?: boolean;
  includeDependencies?: boolean;
}

/**
 * Invoke pmo_EtlBulkCatchup. Returns the parsed summary. `tableName` is only
 * used by the SDK to resolve the Dataverse connection (the action is unbound,
 * bindingtype=0) -- same convention as invokeFlushTaskStaging.
 */
export async function invokeEtlBulkCatchup(params: EtlCatchupParams): Promise<EtlCatchupResult> {
  const res = await dv.executeAction<
    {
      FromDate: string;
      ToDate: string;
      IncludeBuckets?: string;
      IncludeDependencies?: string;
    },
    { Result?: string }
  >(ENTITY_SETS.project, 'pmo_EtlBulkCatchup', {
    FromDate: params.fromDate,
    ToDate: params.toDate,
    // Only send the opt-outs when explicitly false; the API defaults to include.
    ...(params.includeBuckets === false ? { IncludeBuckets: 'false' } : {}),
    ...(params.includeDependencies === false ? { IncludeDependencies: 'false' } : {}),
  });
  return parseEtlCatchupResult(res?.Result);
}

/** Parse the JSON `Result` string. Pure -- unit tested. Tolerates a missing or
 *  malformed payload by returning a zeroed summary rather than throwing. */
export function parseEtlCatchupResult(raw: string | undefined): EtlCatchupResult {
  const empty: EtlCatchupResult = { pushed: 0, failed: 0, byEntity: {} };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Partial<EtlCatchupResult>;
    return {
      pushed: typeof parsed.pushed === 'number' ? parsed.pushed : 0,
      failed: typeof parsed.failed === 'number' ? parsed.failed : 0,
      byEntity: parsed.byEntity ?? {},
    };
  } catch {
    return empty;
  }
}
