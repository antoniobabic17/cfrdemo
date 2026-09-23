/**
 * Unified people-search service.
 *
 * Every people picker in the app (Project Manager, Executive Sponsor, Strategic
 * Account Executive, ...) searches through this one service. The source is
 * governed by the pmo.people_source admin setting (see lib/peopleSource.ts):
 *
 *   'systemuser' -- Dataverse systemuser table (wraps hooks/useIntakeLookups).
 *   'o365'       -- Office 365 / Entra directory via the generated
 *                   Office365UsersService connector client.
 *
 * If source is 'o365' but the connector call fails (connector not wired, no
 * connection, consent error), we soft-fall-back to the systemuser search so a
 * picker never blanks. See docs/planning/sae-systemuser-to-aad-transition-plan.md.
 */
import { useCallback } from 'react';
import * as dv from './dataverseClient';
import { ENTITY_SETS } from './constants';
import { usePeopleSource } from './peopleSource';
import { isDemoActive } from './demoMode';
import { Office365UsersService } from '../generated/services/Office365UsersService';
import type { SelectOption } from '../components/common/SearchableSelect';

/** A person from EITHER source. `id` is the picker's opaque value. */
export interface Person {
  /** Opaque picker value. For o365 this is the AAD object id; for systemuser
   *  it is the systemuserid. Callers that need a specific key use the typed
   *  fields below. */
  id: string;
  displayName: string;
  email?: string;
  /** Entra object id when known (always set from o365; resolved from the
   *  systemuser row when available). */
  aadId?: string;
  /** Dataverse systemuserid when known (always set from systemuser; resolved
   *  from AAD via systemuser lookup when possible in o365 mode). */
  systemUserId?: string;
}

interface SystemUserRow {
  systemuserid: string;
  fullname: string;
  lastname?: string;
  firstname?: string;
  internalemailaddress?: string;
  azureactivedirectoryobjectid?: string;
}

const SU_SELECT = [
  'systemuserid', 'fullname', 'lastname', 'firstname',
  'internalemailaddress', 'azureactivedirectoryobjectid',
];

function fmtName(u: Pick<SystemUserRow, 'fullname' | 'lastname' | 'firstname'>): string {
  if (u.lastname && u.firstname) return `${u.lastname}, ${u.firstname}`;
  return u.fullname;
}

function suToPerson(u: SystemUserRow): Person {
  return {
    id: u.systemuserid,
    systemUserId: u.systemuserid,
    displayName: fmtName(u),
    email: u.internalemailaddress || undefined,
    aadId: u.azureactivedirectoryobjectid || undefined,
  };
}

// ── systemuser branch ────────────────────────────────────────────────────────

async function searchSystemUsers(query: string): Promise<Person[]> {
  const safe = query.replace(/'/g, "''");
  const nameFilter = `(contains(lastname,'${safe}') or contains(firstname,'${safe}') or contains(fullname,'${safe}'))`;
  const rows = await dv.list<SystemUserRow>(ENTITY_SETS.systemUser, {
    $select: SU_SELECT,
    $filter: `isdisabled eq false and ${nameFilter}`,
    $orderby: 'lastname asc,firstname asc',
    $top: 50,
  });
  return rows.map(suToPerson);
}

async function getSystemUser(id: string): Promise<Person | null> {
  try {
    const u = await dv.get<SystemUserRow>(ENTITY_SETS.systemUser, id, SU_SELECT);
    return suToPerson(u);
  } catch {
    return null;
  }
}

/** Resolve a systemuser row by its AAD object id (used to map o365 -> systemuser). */
async function systemUserByAadId(aadId: string): Promise<Person | null> {
  const safe = aadId.replace(/'/g, "''");
  const rows = await dv.list<SystemUserRow>(ENTITY_SETS.systemUser, {
    $select: SU_SELECT,
    $filter: `azureactivedirectoryobjectid eq '${safe}'`,
    $top: 1,
  });
  return rows[0] ? suToPerson(rows[0]) : null;
}

// ── o365 branch ───────────────────────────────────────────────────────────────

async function searchO365(query: string): Promise<Person[]> {
  const res = await Office365UsersService.SearchUserV2(query, 50);
  if (!res.success) throw res.error ?? new Error('SearchUserV2 failed');
  const users = res.data?.value ?? [];
  return users.map((u) => ({
    id: u.Id,
    aadId: u.Id,
    displayName: u.DisplayName ?? u.UserPrincipalName ?? u.Mail ?? u.Id,
    email: u.Mail ?? u.UserPrincipalName ?? undefined,
  }));
}

async function getO365(aadId: string): Promise<Person | null> {
  const res = await Office365UsersService.UserProfile_V2(aadId, 'id,displayName,mail,userPrincipalName');
  if (!res.success || !res.data) return null;
  const u = res.data;
  return {
    id: aadId,
    aadId,
    displayName: u.displayName ?? u.userPrincipalName ?? u.mail ?? aadId,
    email: u.mail ?? u.userPrincipalName ?? undefined,
  };
}

let _o365Warned = false;
function warnO365Fallback(err: unknown) {
  if (_o365Warned) return;
  _o365Warned = true;
  console.warn(
    '[peopleSearch] pmo.people_source=o365 but the Office 365 Users connector '
    + 'call failed; falling back to systemuser search. Wire the connector + '
    + 'connection to enable directory search.', err,
  );
}

// ── Public hook ────────────────────────────────────────────────────────────────

export interface PeopleSearchApi {
  /** Search people; returns unified Person rows. */
  searchPeople: (query: string) => Promise<Person[]>;
  /** Resolve a single Person by picker id (aadId in o365 mode, systemuserid otherwise). */
  resolvePerson: (id: string) => Promise<Person | null>;
  /** Adapter: Person -> SearchableSelect option. */
  toOption: (p: Person) => SelectOption;
}

/**
 * People-search API bound to the current pmo.people_source setting. Re-renders
 * consumers when an admin flips the source.
 */
export function usePeopleSearch(): PeopleSearchApi {
  const source = usePeopleSource();

  const searchPeople = useCallback(async (query: string): Promise<Person[]> => {
    if (query.trim().length < 2) return [];
    // Demo mode: the o365 connector isn't reachable; the systemuser branch
    // is served from in-memory fixtures via dv.list, so use it exclusively.
    if (source === 'o365' && !isDemoActive()) {
      try {
        return await searchO365(query);
      } catch (err) {
        warnO365Fallback(err);
        return searchSystemUsers(query);
      }
    }
    return searchSystemUsers(query);
  }, [source]);

  const resolvePerson = useCallback(async (id: string): Promise<Person | null> => {
    if (!id) return null;
    if (source === 'o365' && !isDemoActive()) {
      try {
        return await getO365(id);
      } catch (err) {
        warnO365Fallback(err);
        return getSystemUser(id);
      }
    }
    return getSystemUser(id);
  }, [source]);

  const toOption = useCallback((p: Person): SelectOption => ({
    value: p.id,
    label: p.email ? `${p.displayName} (${p.email})` : p.displayName,
  }), []);

  return { searchPeople, resolvePerson, toOption };
}

/** Standalone helper: map an o365-picked AAD id to a Dataverse systemuser
 *  (for lookups that must @odata.bind to /systemusers, e.g. PM / Exec Sponsor).
 *  Returns null when no systemuser exists for that identity. */
export async function resolveSystemUserForAadId(aadId: string): Promise<Person | null> {
  return systemUserByAadId(aadId);
}
