/**
 * T021's acceptance, enforced.
 *
 * Parity is already structural — App.tsx and Sidebar.tsx both consume UAT_ROUTES, so a
 * nav entry cannot exist without its route. These tests exist for the case that
 * actually happens: someone reintroduces a hand-written entry in one of the two
 * hotspot files and the structural guarantee quietly stops being a guarantee.
 *
 * Both directions are asserted. "Every nav item has a route" is the half people
 * remember; "every route is reachable" is the half that catches an orphaned page
 * nobody can navigate to, which is how dead code accumulates.
 */
import { describe, expect, it } from 'vitest';
import { UAT_ROUTES, UAT_ROUTE_PATHS, getUatNavItems } from './routes';
import { ALL_UAT_TOGGLE_KEYS, UAT_TOGGLE_KEYS } from './lib/uatToggles';

const appSource = Object.values(
  import.meta.glob('../../App.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
)[0];

const sidebarSource = Object.values(
  import.meta.glob('../../components/layout/Sidebar.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
)[0];

describe('UAT nav and route parity', () => {
  it('loaded both hotspot files', () => {
    expect(appSource, 'App.tsx was not loaded').toBeTruthy();
    expect(sidebarSource, 'Sidebar.tsx was not loaded').toBeTruthy();
  });

  it('every nav item has a matching route', () => {
    const routePaths = new Set(UAT_ROUTE_PATHS);
    const orphanNav = getUatNavItems()
      .map((item) => item.path.replace(/^\//, ''))
      .filter((path) => !routePaths.has(path));
    expect(orphanNav, 'These nav items point at no route — dead links.').toEqual([]);
  });

  it('every route is reachable from nav or is an explicit detail route', () => {
    // A route with no nav entry must be a parameterised detail route, reached from a
    // list. Anything else is a page nobody can get to.
    const navPaths = new Set(getUatNavItems().map((i) => i.path.replace(/^\//, '')));
    const unreachable = UAT_ROUTES
      .filter((r) => !r.nav && !r.path.includes(':'))
      .map((r) => r.path)
      .filter((p) => !navPaths.has(p));
    expect(
      unreachable,
      'These routes have no nav entry and are not detail routes — nothing can reach them.',
    ).toEqual([]);
  });

  it('derives the nav from the route list in Sidebar.tsx rather than restating it', () => {
    expect(sidebarSource).toContain('getUatNavItems()');
    // A hand-written '/uat...' literal in the nav config is the drift this guards.
    const handWritten = (sidebarSource.match(/path:\s*'\/uat[^']*'/g) ?? []);
    expect(
      handWritten,
      'Sidebar must derive UAT items from features/uat/routes.tsx, not list them.',
    ).toEqual([]);
  });

  it('renders the route list in App.tsx rather than restating it', () => {
    expect(appSource).toContain('UAT_ROUTES.map(');
    const handWritten = (appSource.match(/path="uat[^"]*"/g) ?? []);
    expect(
      handWritten,
      'App.tsx must map UAT_ROUTES, not declare UAT routes individually.',
    ).toEqual([]);
  });

  it('gates the whole UAT nav section on nav.uat', () => {
    expect(sidebarSource).toContain('UAT_TOGGLE_KEYS.nav');
  });

  it('uses useEffectiveFeatureToggles, so a team opt-out is honoured', () => {
    // useFeatureToggles alone would ignore team overrides — the nav would keep showing
    // UAT to a team that had opted out.
    expect(sidebarSource).toContain('useEffectiveFeatureToggles');
  });

  it('gates every nav item on a real UAT capability key', () => {
    const valid = new Set<string>(ALL_UAT_TOGGLE_KEYS);
    const bad = getUatNavItems().filter((i) => !valid.has(i.toggleKey)).map((i) => i.toggleKey);
    expect(bad).toEqual([]);
  });

  it('lazily loads every route element', () => {
    // Matching every other route block in App.tsx: an app that never opens UAT should
    // not pay for its bundle.
    const routesSource = Object.values(
      import.meta.glob('./routes.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
    )[0];
    expect(routesSource).toContain('lazy(');
    expect(routesSource).not.toMatch(/^import\s+\{?\s*Uat\w+Page/m);
  });
});

/**
 * Like-surface parity, from the component-patterns standard.
 *
 * Its named anti-pattern is implementing a grid feature on a standalone queue page and
 * forgetting the matching tab inside a detail page. UAT has exactly that shape: a
 * cross-project area and a per-project tab showing the same records. The pairing is
 * declared as data so a later phase cannot claim it did not know.
 */
describe('like-surface parity declarations', () => {
  it('makes every area declare where else its records appear', () => {
    const undeclared = UAT_ROUTES.filter((r) => r.alsoRenderedBy === undefined).map((r) => r.path);
    expect(undeclared).toEqual([]);
  });

  it('pairs every entity-bearing area with the project-detail tab', () => {
    // Templates are the deliberate exception: they are configuration authored once and
    // reused, so a per-project copy would reintroduce the duplication this model
    // removes. Every other area shows per-project records and must appear on both.
    //
    // uat/templates/:id inherits that reason exactly — it is the list's own detail route,
    // so if the list is single-surface the detail cannot be anything else. Note this is
    // NOT a licence for detail routes generally: uat/test-cases/:id declares the project
    // tab, because test cases DO belong to a project and do appear on both surfaces.
    //
    // uat/imports/:id (T040) is the third, and its reason is different from the templates'.
    // A batch's outcome is read once, by the person who just pressed the button, to fix the
    // rows that failed. It is not a record a project team browses, and the cases it created
    // DO appear on both test-case surfaces — which is where the per-project view of an
    // import's result actually lives. The batch page is the audit trail of one action.
    const singleSurface = UAT_ROUTES.filter((r) => r.alsoRenderedBy.length === 0).map((r) => r.path);
    expect(
      singleSurface,
      'A new single-surface UAT area needs a stated reason here, or it is a parity gap.',
    ).toEqual(['uat/templates', 'uat/templates/:id', 'uat/imports/:id']);
  });

  it('covers every capability key with at least one route', () => {
    // A capability an admin can toggle but that no route consumes is a control that
    // does nothing.
    const gated = new Set(getUatNavItems().map((i) => i.toggleKey));
    const unused = ALL_UAT_TOGGLE_KEYS.filter(
      (k) => k !== UAT_TOGGLE_KEYS.projectTab && !gated.has(k),
    );
    expect(unused, 'These toggle keys gate nothing in the nav.').toEqual([]);
  });
});
