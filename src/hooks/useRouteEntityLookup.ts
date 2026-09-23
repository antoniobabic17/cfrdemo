/**
 * useRouteEntityLookup -- resolve GUIDs found in HashRouter paths back to
 * human names for display in the Error Log page.
 *
 * The Page column of the Error Log stores raw hash routes like
 *   #/projects/7c90f984-6c75-f111-ab0f-7ced8dde8301
 * which are unreadable at a glance. This hook extracts the GUIDs from the
 * routes it's given, buckets them by entity segment (`projects`, `programs`,
 * `intake`, etc.), and fires one query per entity to resolve each GUID's
 * display name. The result is a Map<guid, {name, entity}> that the caller
 * uses to render "abc-123 (Project Name)" in the table cell.
 *
 * One round-trip per entity type across the full page's GUIDs (not per row)
 * so the added query cost is O(entity-types) not O(rows).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';

const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// Non-global variant for stateless single-match `.test()` -- avoids the
// lastIndex-carrying trap that GUID_RE has when reused across calls.
const GUID_TEST_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Map from route segment (before the GUID) to entity metadata. */
const ROUTE_ENTITY_MAP: Record<string, {
  set: string;
  idField: string;
  nameField: string;
  label: string;
}> = {
  projects: {
    set: ENTITY_SETS.project,
    idField: 'msdyn_projectid',
    nameField: 'msdyn_subject',
    label: 'project',
  },
  programs: {
    set: ENTITY_SETS.program,
    idField: 'msdyn_projectprogramid',
    nameField: 'msdyn_name',
    label: 'program',
  },
  intake: {
    set: ENTITY_SETS.projectRequest,
    idField: 'pmo_projectrequestid',
    nameField: 'pmo_title',
    label: 'intake',
  },
  teams: {
    set: ENTITY_SETS.team,
    idField: 'teamid',
    nameField: 'name',
    label: 'team',
  },
  hpi: {
    set: ENTITY_SETS.hpiIssue,
    idField: 'rcm_payerdeckissueid',
    // HPI rows are keyed by rcm_issuenumber (auto-number 'M-XXX') for users.
    // rcm_name often just repeats the issue number; the auto-number is the
    // canonical human handle so use it as the display name.
    nameField: 'rcm_issuenumber',
    label: 'HPI',
  },
  'payer-issues': {
    set: ENTITY_SETS.payerIssue,
    idField: 'cr87a_payerissueid',
    nameField: 'cr87a_name',
    label: 'Payer Inquiry',
  },
};

export interface RouteEntityLabel {
  guid: string;
  name: string;
  entity: string;
}

/**
 * Given a set of route strings, resolve every GUID appearing after a known
 * entity segment to its display name. Returns a Map keyed on lowercased
 * GUID. Rows missing from the map render as "unknown".
 */
export function useRouteEntityLookup(routes: string[]): {
  labels: Map<string, RouteEntityLabel>;
  loading: boolean;
} {
  // Bucket every GUID we can find by the entity segment that precedes it.
  const buckets = useMemo(() => {
    const b: Record<string, Set<string>> = {};
    for (const r of routes) {
      if (!r) continue;
      // Strip hash prefix and query, then split.
      const path = r.replace(/^#/, '').split('?')[0].split('#')[0];
      const segs = path.split('/').filter(Boolean);
      for (let i = 0; i < segs.length - 1; i++) {
        const key = segs[i].toLowerCase();
        if (!(key in ROUTE_ENTITY_MAP)) continue;
        const val = segs[i + 1];
        const matches = val.match(GUID_RE);
        if (!matches) continue;
        for (const g of matches) {
          const gl = g.toLowerCase();
          (b[key] ||= new Set()).add(gl);
        }
      }
    }
    return b;
  }, [routes]);

  // One query per entity segment. React Query caches individual results so
  // navigating between error rows doesn't refetch.
  const queries = [
    useEntityBatch('projects', buckets.projects),
    useEntityBatch('programs', buckets.programs),
    useEntityBatch('intake', buckets.intake),
    useEntityBatch('teams', buckets.teams),
    useEntityBatch('hpi', buckets.hpi),
    useEntityBatch('payer-issues', buckets['payer-issues']),
  ];

  const labels = useMemo(() => {
    const m = new Map<string, RouteEntityLabel>();
    for (const q of queries) {
      if (!q.data) continue;
      for (const row of q.data) m.set(row.guid.toLowerCase(), row);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, queries.map((q) => q.data));

  const loading = queries.some((q) => q.isPending);
  return { labels, loading };
}

function useEntityBatch(segment: string, ids: Set<string> | undefined) {
  const meta = ROUTE_ENTITY_MAP[segment];
  const guidList = ids ? [...ids].sort() : [];
  return useQuery({
    queryKey: ['routeEntityLookup', segment, guidList] as const,
    enabled: !!meta && guidList.length > 0,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<RouteEntityLabel[]> => {
      if (!meta || guidList.length === 0) return [];
      // OData `or` filter chaining -- one round trip for the whole batch.
      const filter = guidList.map((g) => `${meta.idField} eq '${g}'`).join(' or ');
      const rows = await dv.list<Record<string, unknown>>(meta.set, {
        $select: [meta.idField, meta.nameField],
        $filter: filter,
        $top: Math.max(guidList.length, 5),
      });
      return rows.map((r) => ({
        guid: String(r[meta.idField]),
        name: String(r[meta.nameField] ?? '(unnamed)'),
        entity: meta.label,
      }));
    },
  });
}

/**
 * Format a hash route with any recognized GUIDs replaced by "guid (Name)".
 * Called from ErrorLogPage's Page column renderer.
 */
export function annotateRouteWithNames(
  route: string,
  labels: Map<string, RouteEntityLabel>,
): string {
  if (!route) return route;
  return route.replace(GUID_RE, (guid) => {
    const label = labels.get(guid.toLowerCase());
    if (!label) return guid;
    return `${guid} (${label.name})`;
  });
}

/**
 * Compact user-friendly label for a hash route. Preferred over
 * `annotateRouteWithNames` in surfaces like chart legends where the raw
 * hash + GUID + parens is too noisy.
 *
 * Examples (given resolved labels):
 *   '#/projects/<guid>'      -> 'Projects/Aetna Reserves'
 *   '#/hpi/<guid>'           -> 'HPI/M-506'
 *   '#/payer-issues/<guid>'  -> 'Payer Inquiry/BCBS Prior Auth drift'
 *   '#/admin/error-log'      -> 'Admin > Error Log'
 *   '#/hpi'                  -> 'HPI'
 *   '#/intake/new'           -> 'Intake/new'
 *
 * Falls back to a Title-Cased path (segments joined by '/') when the
 * route matches no known entity segment, so an unrecognized route still
 * reads better than the raw string.
 */
const SEGMENT_LABELS: Record<string, string> = {
  projects: 'Projects',
  programs: 'Programs',
  intake: 'Intake',
  teams: 'Teams',
  hpi: 'HPI',
  'payer-issues': 'Payer Inquiry',
  admin: 'Admin',
  analytics: 'Analytics',
  reports: 'Reports',
  'error-log': 'Error Log',
  permissions: 'Permissions',
  settings: 'Settings',
};

function titleCaseSegment(seg: string): string {
  if (SEGMENT_LABELS[seg]) return SEGMENT_LABELS[seg];
  // Preserve any-case entity-name-ish segments; only prettify plain kebab/snake.
  return seg
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function friendlyRouteLabel(
  route: string,
  labels: Map<string, RouteEntityLabel>,
): string {
  if (!route) return route;
  const path = route.replace(/^#/, '').split('?')[0].split('#')[0];
  const segs = path.split('/').filter(Boolean);
  if (segs.length === 0) return 'Home';

  // Walk segments; when a known entity segment is followed by a GUID, try
  // to resolve the GUID to a name and emit 'Label/Name'. Non-entity
  // segments are Title-cased. Trailing GUIDs after a non-entity segment
  // fall back to the raw GUID (rare -- most routes are entity/id shaped).
  const out: string[] = [];
  let i = 0;
  while (i < segs.length) {
    const s = segs[i];
    const next = segs[i + 1];
    if (s.toLowerCase() in ROUTE_ENTITY_MAP && next && GUID_TEST_RE.test(next)) {
      const resolved = labels.get(next.toLowerCase());
      const name = resolved?.name ?? next.slice(0, 8);
      out.push(`${SEGMENT_LABELS[s.toLowerCase()] ?? titleCaseSegment(s)}/${name}`);
      i += 2;
      continue;
    }
    // Bare segment (list page, non-entity path piece).
    out.push(titleCaseSegment(s));
    i += 1;
  }
  return out.join(' > ');
}
