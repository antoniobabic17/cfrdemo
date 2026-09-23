/**
 * lookupResolver — resolve a lookup column's chosen "aspect" (which part of the
 * related record to display) to a concrete value per row.
 *
 * Platform constraint: the Power Apps Code Apps SDK has NO $expand, so a list
 * query only yields two FREE aspects for a lookup:
 *   - 'name'  → the primary-name FormattedValue annotation (auto-returned)
 *   - 'guid'  → the raw `_<key>_value` id
 * Any OTHER aspect (email, or a target-specific attribute) needs a SECONDARY
 * batch fetch of the target table by the ids collected across the page, joined
 * client-side (dv.listByIds). This module describes each target's aspects and
 * performs those fetches.
 */
import * as dv from './dataverseClient';

/** A selectable aspect definition for a lookup target entity. */
export interface AspectDef {
  /** Stored aspect id (matches LookupAspect). */
  id: string;
  /** Human label shown in the aspect picker. */
  label: string;
  /** How the value is obtained. 'free' = from the primary query (name/guid);
   *  'fetch' = requires the secondary batch fetch of `attr` from the target. */
  kind: 'free' | 'fetch';
  /** For kind==='fetch': the target attribute to $select and display. */
  attr?: string;
}

/** Per-target-entity descriptor: its entity-set, id field, and aspects. */
export interface TargetDef {
  entitySet: string;
  idField: string;
  aspects: AspectDef[];
}

const NAME_ASPECT: AspectDef = { id: 'name', label: 'Name', kind: 'free' };
const GUID_ASPECT: AspectDef = { id: 'guid', label: 'ID (GUID)', kind: 'free' };

/**
 * Known lookup targets and the aspects they support. systemuser (and its
 * aaduser projection, same ids) exposes email + title beyond name/guid. Unknown
 * targets fall back to name + guid only (both free — no secondary fetch).
 */
const TARGETS: Record<string, TargetDef> = {
  systemuser: {
    entitySet: 'systemusers',
    idField: 'systemuserid',
    aspects: [
      NAME_ASPECT,
      { id: 'email', label: 'Email', kind: 'fetch', attr: 'internalemailaddress' },
      { id: 'title', label: 'Job Title', kind: 'fetch', attr: 'title' },
      GUID_ASPECT,
    ],
  },
  // aaduser is a filtered projection of systemuser and shares the same GUIDs, so
  // it resolves against the systemusers set.
  aaduser: {
    entitySet: 'systemusers',
    idField: 'systemuserid',
    aspects: [
      NAME_ASPECT,
      { id: 'email', label: 'Email', kind: 'fetch', attr: 'internalemailaddress' },
      { id: 'title', label: 'Job Title', kind: 'fetch', attr: 'title' },
      GUID_ASPECT,
    ],
  },
};

/** Resolve the target descriptor for a lookup's target entity list. Uses the
 *  first known target; falls back to a name+guid-only descriptor. */
export function targetDefFor(targets: string[] | undefined): TargetDef | undefined {
  if (!targets || targets.length === 0) return undefined;
  for (const t of targets) {
    const def = TARGETS[t.toLowerCase()];
    if (def) return def;
  }
  return undefined;
}

/** The aspect options to offer in the picker for a lookup column. Always at
 *  least Name + GUID; known targets add email/title etc. */
export function aspectOptionsFor(targets: string[] | undefined): AspectDef[] {
  return targetDefFor(targets)?.aspects ?? [NAME_ASPECT, GUID_ASPECT];
}

/** True when an aspect needs the secondary batch fetch (not free from the list query). */
export function aspectNeedsFetch(targets: string[] | undefined, aspect: string): boolean {
  const def = targetDefFor(targets);
  const a = def?.aspects.find((x) => x.id === aspect);
  return !!a && a.kind === 'fetch';
}

export interface ResolveRequest {
  /** The lookup column key, e.g. '_cr87a_requester_value'. */
  colKey: string;
  /** Lookup target logical names from the catalog. */
  targets: string[] | undefined;
  /** Chosen aspect id (email/title/...) — must be a 'fetch' aspect. */
  aspect: string;
  /** Distinct related-record ids to resolve (the `_<key>_value` values). */
  ids: string[];
}

/**
 * Perform the secondary fetches for a set of lookup columns whose aspect needs
 * it. Returns a map: colKey -> (relatedId -> resolved display value).
 * Each target table is fetched once per column via dv.listByIds (bounded).
 */
export async function resolveLookupAspects(
  requests: ResolveRequest[],
): Promise<Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, string>> = {};
  await Promise.all(requests.map(async (req) => {
    const def = targetDefFor(req.targets);
    const aspect = def?.aspects.find((a) => a.id === req.aspect);
    if (!def || !aspect || aspect.kind !== 'fetch' || !aspect.attr) return;
    if (req.ids.length === 0) { out[req.colKey] = {}; return; }
    const rows = await dv.listByIds<Record<string, unknown>>(
      def.entitySet, def.idField, req.ids, [def.idField, aspect.attr],
    );
    const map: Record<string, string> = {};
    for (const row of rows) {
      const id = String(row[def.idField] ?? '').toLowerCase();
      const val = row[aspect.attr!];
      if (id) map[id] = val == null ? '' : String(val);
    }
    out[req.colKey] = map;
  }));
  return out;
}
