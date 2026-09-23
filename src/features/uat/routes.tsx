/**
 * UAT routes and navigation — ONE list feeding BOTH.
 *
 * App.tsx and Sidebar.tsx each carry a COORDINATION [HIGH-RISK] comment requiring the
 * other to be updated in the same commit, because a nav entry without a route is a
 * dead link and a route without a nav entry is unreachable. Two hand-maintained lists
 * make that a discipline problem forever.
 *
 * So parity here is STRUCTURAL rather than reviewed: `UAT_ROUTES` is the single source,
 * App.tsx maps it to <Route> elements and Sidebar.tsx maps the subset with a `nav`
 * block to nav items. A route cannot drift from its nav entry because there is only
 * one of each. uatRoutes.test.ts still asserts parity in both directions — belt and
 * braces, and it catches the case where someone reintroduces a hand-written entry.
 *
 * LAZY. Every element is lazy()-loaded, matching every other route block in App.tsx,
 * so an app that never opens UAT never pays for its bundle.
 *
 * LIKE-SURFACE PARITY. Each entity-bearing area below declares `alsoRenderedBy`,
 * naming the other surface that shows the same records — for UAT that is the
 * project-detail tab (T022). The component standards' named anti-pattern is
 * implementing search on a standalone queue page and forgetting the matching tab, so
 * the pairing is data here rather than folklore, and the test asserts every
 * entity-bearing area declares one.
 */
import { lazy } from 'react';
import type { ReactNode } from 'react';
import {
  ClipboardCheck,
  FileStack,
  Bug,
  ListChecks,
  Network,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { UAT_TOGGLE_KEYS, type UatToggleKey } from './lib/uatToggles';

/**
 * Every area now has a real page. The `UatAreaPlaceholder` component that stood in for them
 * through Phases 4–9 was RETIRED with T047, the task that filled the last two routes — a
 * placeholder nothing renders is a page a future reader has to decide about, and a route table
 * that still imports one invites the next area to reach for it instead of being built.
 */
const TemplateListPage = lazy(() =>
  import('./pages/TemplateListPage').then((m) => ({ default: m.TemplateListPage })),
);
const TemplateDetailPage = lazy(() =>
  import('./pages/TemplateDetailPage').then((m) => ({ default: m.TemplateDetailPage })),
);
/** Phase 5 (T026) delivered the test-case pair. */
const TestCaseListPage = lazy(() =>
  import('./pages/TestCaseListPage').then((m) => ({ default: m.TestCaseListPage })),
);
const TestCaseDetailPage = lazy(() =>
  import('./pages/TestCaseDetailPage').then((m) => ({ default: m.TestCaseDetailPage })),
);
/** Phase 7 (T037) replaced the import placeholder with the real wizard. */
const ImportWizardPage = lazy(() =>
  import('./pages/ImportWizardPage').then((m) => ({ default: m.ImportWizardPage })),
);
/** Phase 7 (T040) — one batch's outcome, per row. */
const ImportBatchPage = lazy(() =>
  import('./pages/ImportBatchPage').then((m) => ({ default: m.ImportBatchPage })),
);
/** Phase 10 (T047) replaced the requirements and coverage placeholders. */
const RequirementListPage = lazy(() =>
  import('./pages/RequirementListPage').then((m) => ({ default: m.RequirementListPage })),
);
const RequirementDetailPage = lazy(() =>
  import('./pages/RequirementDetailPage').then((m) => ({ default: m.RequirementDetailPage })),
);
/** Phase 11 (T051) — cycles and their pace. */
const CycleDetailPage = lazy(() =>
  import('./pages/CycleDetailPage').then((m) => ({ default: m.CycleDetailPage })),
);
/** Phase 8 (T042) replaced the defects placeholder. */
const DefectListPage = lazy(() =>
  import('./pages/DefectListPage').then((m) => ({ default: m.DefectListPage })),
);

/** Where else the same records are reachable from. See LIKE-SURFACE PARITY above. */
export type UatLikeSurface = 'project-detail-tab';

export interface UatNavDef {
  /** Sidebar label. */
  label: string;
  icon: LucideIcon;
  /**
   * The capability key gating this entry, ON TOP of UAT_TOGGLE_KEYS.nav which gates
   * the whole section. Both must be on for the item to appear.
   */
  toggleKey: UatToggleKey;
}

export interface UatRouteDef {
  /** Path relative to the app shell, with no leading slash — matches App.tsx. */
  path: string;
  element: ReactNode;
  /** Present when this route also appears in the sidebar. */
  nav?: UatNavDef;
  /**
   * Other surfaces rendering these same records. Required for any area that shows
   * entity data, so a later phase cannot add a grid feature to one surface only.
   * Empty array means "this area is genuinely single-surface" and must be deliberate.
   */
  alsoRenderedBy: readonly UatLikeSurface[];
}

/**
 * THE single source of truth for UAT routing and navigation.
 *
 * Ordered as the sidebar shows them: the work a tester does most often first.
 */
export const UAT_ROUTES: readonly UatRouteDef[] = [
  {
    path: 'uat',
    element: <TestCaseListPage />,
    nav: { label: 'UAT Overview', icon: ClipboardCheck, toggleKey: UAT_TOGGLE_KEYS.nav },
    // The overview aggregates across projects; the project tab is its per-project twin.
    alsoRenderedBy: ['project-detail-tab'],
  },
  {
    path: 'uat/templates',
    element: <TemplateListPage />,
    nav: { label: 'Templates', icon: FileStack, toggleKey: UAT_TOGGLE_KEYS.templates },
    // Templates are configuration, authored once and reused. Deliberately not on the
    // project tab: a per-project copy is exactly the duplication this model removes.
    alsoRenderedBy: [],
  },
  {
    // Detail route, reachable from the list rather than the sidebar — hence no nav block.
    // Single-surface for the same reason the list is.
    path: 'uat/templates/:id',
    element: <TemplateDetailPage />,
    alsoRenderedBy: [],
  },
  {
    path: 'uat/requirements',
    element: <RequirementListPage />,
    nav: { label: 'Requirements', icon: ListChecks, toggleKey: UAT_TOGGLE_KEYS.requirements },
    alsoRenderedBy: ['project-detail-tab'],
  },
  {
    // The coverage view is a tab ON the requirements page, over the same rows, so "what is
    // covered" and "what requirements exist" cannot disagree. This route lands there with the
    // coverage tab selected rather than rendering a second, separately-fed matrix.
    path: 'uat/coverage',
    element: <RequirementListPage />,
    nav: { label: 'Coverage', icon: Network, toggleKey: UAT_TOGGLE_KEYS.coverage },
    alsoRenderedBy: ['project-detail-tab'],
  },
  {
    path: 'uat/defects',
    element: <DefectListPage />,
    nav: { label: 'Defects', icon: Bug, toggleKey: UAT_TOGGLE_KEYS.defects },
    alsoRenderedBy: ['project-detail-tab'],
  },
  {
    path: 'uat/import',
    element: <ImportWizardPage />,
    nav: { label: 'Import', icon: Upload, toggleKey: UAT_TOGGLE_KEYS.import },
    alsoRenderedBy: ['project-detail-tab'],
  },
  {
    // Parameterised on the PROJECT, not on a cycle: the page shows all of one project's cycles
    // and the pace of the selected one, and a cycle only means anything inside its project. No
    // sidebar entry — a cycle is a window of one project's work, and the portfolio view of pace
    // is the dashboard rollup. T021's reachability guard rejected a bare `uat/cycles` with no
    // nav entry, which was the right refusal: nothing could have reached it.
    path: 'uat/cycles/:projectId',
    element: <CycleDetailPage />,
    alsoRenderedBy: ['project-detail-tab'],
  },
  {
    // Detail route, reachable from the requirement list rather than the sidebar.
    path: 'uat/requirements/:id',
    element: <RequirementDetailPage />,
    alsoRenderedBy: ['project-detail-tab'],
  },
  {
    // Detail route, reachable from the wizard and from the project's import list rather than
    // the sidebar — hence no nav block. Single-surface: a batch's outcome is only ever read
    // in one place, and a per-project copy would be the duplication this model removes.
    path: 'uat/imports/:id',
    element: <ImportBatchPage />,
    alsoRenderedBy: [],
  },
  {
    // Detail route, reachable from a list rather than the sidebar — hence no nav block.
    path: 'uat/test-cases/:id',
    element: <TestCaseDetailPage />,
    alsoRenderedBy: ['project-detail-tab'],
  },
];

/** Nav items derived from the routes, so the two cannot disagree. */
export interface UatNavItem {
  /** Sidebar path, with the leading slash the sidebar expects. */
  path: string;
  label: string;
  icon: LucideIcon;
  toggleKey: UatToggleKey;
}

export function getUatNavItems(): UatNavItem[] {
  return UAT_ROUTES.filter((r) => r.nav).map((r) => ({
    path: `/${r.path}`,
    label: r.nav!.label,
    icon: r.nav!.icon,
    toggleKey: r.nav!.toggleKey,
  }));
}

/** Every route path, for the parity assertions. */
export const UAT_ROUTE_PATHS: readonly string[] = UAT_ROUTES.map((r) => r.path);
