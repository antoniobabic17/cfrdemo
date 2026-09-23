/**
 * Catalog of left-navigation tabs, keyed by their `toggleKey`.
 *
 * This is the master list the per-team tab-visibility editor renders from
 * (initiative #4). It mirrors the "Left Navigation" group in
 * components/admin/FeatureToggleSection.tsx and the `toggleKey`s on
 * NAV_SECTIONS in components/layout/Sidebar.tsx. Keep the three in sync when
 * adding a nav item (a missing entry here just means that tab can't be picked
 * in the allowlist editor — it does not break the sidebar).
 *
 * Only `nav.*` keys belong here; header/intakeCard/projectTab toggles are not
 * part of left-nav tab visibility.
 */
export interface NavCatalogItem {
  key: string;
  label: string;
}

export interface NavCatalogGroup {
  heading: string;
  items: NavCatalogItem[];
}

export const NAV_TAB_CATALOG: NavCatalogGroup[] = [
  {
    heading: 'General',
    items: [
      { key: 'nav.dashboard', label: 'Dashboard' },
      { key: 'nav.intakeQueue', label: 'Intake Queue' },
    ],
  },
  {
    heading: 'Portfolio',
    items: [
      { key: 'nav.projects', label: 'Projects' },
      { key: 'nav.programs', label: 'Programs' },
      { key: 'nav.statusReports', label: 'Status Reports' },
    ],
  },
  {
    heading: 'Analytics & Reporting',
    items: [
      { key: 'nav.analyticsOverview', label: 'Overview' },
      { key: 'nav.analyticsByTeam', label: 'By Team' },
      { key: 'nav.analyticsPipeline', label: 'Pipeline' },
      { key: 'nav.analyticsHealth', label: 'Health Matrix' },
      { key: 'nav.analyticsSchedule', label: 'Schedule' },
      { key: 'nav.analyticsGovernance', label: 'Governance' },
      { key: 'nav.analyticsCapacity', label: 'Capacity' },
      { key: 'nav.analyticsPrioritization', label: 'Prioritization' },
      { key: 'nav.analyticsFinancials', label: 'Financials' },
      { key: 'nav.analyticsScenarios', label: 'Scenarios' },
      { key: 'nav.analyticsVariance', label: 'Variance' },
      { key: 'nav.analyticsRoadmap', label: 'Roadmap' },
      { key: 'nav.analyticsIntakePipeline', label: 'Intake Analytics' },
      { key: 'nav.analyticsRoutingQa', label: 'Routing QA' },
    ],
  },
];

/** Flat list of every nav toggleKey in the catalog. */
export const ALL_NAV_TAB_KEYS: string[] = NAV_TAB_CATALOG.flatMap((g) => g.items.map((i) => i.key));
