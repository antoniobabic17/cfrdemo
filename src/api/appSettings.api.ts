import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';

export interface AppSetting {
  pmo_appsettingid: string;
  pmo_key: string;
  pmo_value: string | null;
  pmo_description: string | null;
  modifiedon?: string;
}

const SET = ENTITY_SETS.appSetting;
const TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Settings query timed out after ${ms}ms — the pmo_appsettings table may not yet be available in this session. Reload the page and try again.`)), ms),
    ),
  ]);
}

export async function listSettings(): Promise<AppSetting[]> {
  return withTimeout(
    dv.list<AppSetting>(SET, {
      $select: ['pmo_appsettingid', 'pmo_key', 'pmo_value', 'pmo_description', 'modifiedon'],
      $filter: 'statecode eq 0',
      $orderby: 'pmo_key asc',
    }),
    TIMEOUT_MS,
  );
}

export async function upsertSetting(
  key: string,
  value: string,
  existing?: AppSetting,
): Promise<void> {
  if (existing) {
    await dv.update(SET, existing.pmo_appsettingid, { pmo_value: value });
  } else {
    await dv.create(SET, { pmo_key: key, pmo_value: value });
  }
}

export async function deleteSetting(existing: AppSetting): Promise<void> {
  await dv.remove(SET, existing.pmo_appsettingid);
}
