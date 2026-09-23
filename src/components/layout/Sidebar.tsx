import { useState, useEffect, useSyncExternalStore, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useSidebarState } from './AppShell';
import {
  LayoutDashboard,
  Inbox,
  FolderKanban,
  Network,
  FileBarChart2,
  Users,
  Activity,
  GitBranch,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  BarChart3,
  Settings,
  ShieldCheck,
  Gauge,
  Trophy,
  DollarSign,
  Map,
  GitCompare,
  TrendingUp,
  History,
  Calendar,
  Bot,
  MessageSquareText,
  AlertOctagon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAdminRole, useEffectiveAdminRole, useConfig } from '../../providers/ConfigurationProvider';
import { ENV_BADGE_COLORS } from '../../lib/constants';
import { useEffectiveFeatureToggles } from '../../hooks/useEffectiveFeatureToggles';
import { getUatNavItems } from '../../features/uat/routes';
import { UAT_TOGGLE_KEYS } from '../../features/uat/lib/uatToggles';
import { useIsSystemsImprovementActive } from '../../features/teams/_shared/useIsSystemsImprovementActive';
import { isImpersonatingUser, setImpersonatingUser, subscribeToImpersonation } from '../../lib/adminImpersonation';
import { UserCog, Users as UsersIcon } from 'lucide-react';
import { useCurrentUserTeamsWithNames } from '../../hooks/useCurrentUserTeams';
import { useAllPmoTeams } from '../../hooks/useAllPmoTeams';
import { resolveSidebarTeamName, SIDEBAR_TEAM_ORDER_SETTING_KEY } from '../../lib/pmoTeams';
import { useAppSettings } from '../../hooks/useAppSettings';
import { ActAsTeamMemberPills } from '../../features/teams/_shared/ActAsTeamMemberPills';
import { useActiveTeamFeatures } from '../../features/teams/_shared/useActiveTeamFeatures';
import { useTeamTabAllowlist } from '../../hooks/useTeamTabAllowlist';
import { isNavItemAllowed } from '../../lib/teamTabVisibility';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { useActionableCount } from '../../hooks/useActionItems';
import { useNewFeedbackCount } from '../../hooks/useUserFeedback';
import { isDemoActive } from '../../lib/demoMode';

interface NavItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  toggleKey?: string;
}

interface NavSection {
  id: string;
  header: string;
  items: NavItem[];
  defaultOpen?: boolean;
}

// COORDINATION [HIGH-RISK]: Every entry here must have a Route in App.tsx. Add both in the same commit.
// Open and assign a GitHub Issue before editing this file. See CONTRIBUTING.md §Shared Files.
const NAV_SECTIONS: NavSection[] = [
  {
    id: 'intake',
    header: 'Intake & Requests',
    defaultOpen: true,
    items: [
      { path: '/intake', label: 'Intake Queue', icon: Inbox, toggleKey: 'nav.intakeQueue' },
    ],
  },
  {
    id: 'portfolio',
    header: 'Portfolio',
    defaultOpen: true,
    items: [
      { path: '/programs', label: 'Programs', icon: Network, toggleKey: 'nav.programs' },
      { path: '/projects', label: 'Projects', icon: FolderKanban, toggleKey: 'nav.projects' },
      { path: '/status-reports', label: 'Status Reports', icon: FileBarChart2, toggleKey: 'nav.statusReports' },
    ],
  },
  {
    // PIT (Payer Initiatives Team) group. Items are contributed ONLY by the
    // Payer Initiatives feature pack (HPI + Payer Inquiries) via useActiveTeamFeatures,
    // so this group is empty — and thus filtered out — for anyone who isn't a PI
    // member or an admin acting-as-PI. No separate gating needed.
    id: 'pit',
    header: 'PIT',
    defaultOpen: false,
    items: [],
  },
  {
    // UAT Manager (spec 001). Items are DERIVED from features/uat/routes.tsx via
    // getUatNavItems() rather than listed here, so a nav entry cannot exist without
    // its route -- the invariant this file's COORDINATION header exists to protect.
    // The whole section is additionally gated on nav.uat in the component below.
    id: 'uat',
    header: 'UAT',
    defaultOpen: false,
    items: getUatNavItems(),
  },
  {
    id: 'analytics',
    header: 'Analytics & Reporting',
    defaultOpen: false,
    items: [
      { path: '/analytics', label: 'Overview', icon: BarChart3, toggleKey: 'nav.analyticsOverview' },
      { path: '/analytics/by-team', label: 'By Team', icon: Users, toggleKey: 'nav.analyticsByTeam' },
      { path: '/analytics/pipeline', label: 'Pipeline', icon: GitBranch, toggleKey: 'nav.analyticsPipeline' },
      { path: '/analytics/health', label: 'Health Matrix', icon: Activity, toggleKey: 'nav.analyticsHealth' },
      { path: '/analytics/schedule', label: 'Schedule', icon: Calendar, toggleKey: 'nav.analyticsSchedule' },
      { path: '/analytics/governance', label: 'Governance', icon: ShieldCheck, toggleKey: 'nav.analyticsGovernance' },
      { path: '/analytics/capacity', label: 'Capacity', icon: Gauge, toggleKey: 'nav.analyticsCapacity' },
      { path: '/analytics/prioritization', label: 'Prioritization', icon: Trophy, toggleKey: 'nav.analyticsPrioritization' },
      { path: '/analytics/financials', label: 'Financials', icon: DollarSign, toggleKey: 'nav.analyticsFinancials' },
      { path: '/analytics/scenarios', label: 'Scenarios', icon: GitCompare, toggleKey: 'nav.analyticsScenarios' },
      { path: '/analytics/variance', label: 'Variance', icon: TrendingUp, toggleKey: 'nav.analyticsVariance' },
      { path: '/analytics/roadmap', label: 'Roadmap', icon: Map, toggleKey: 'nav.analyticsRoadmap' },
      { path: '/analytics/intake-pipeline', label: 'Intake Analytics', icon: GitBranch, toggleKey: 'nav.analyticsIntakePipeline' },
      { path: '/analytics/routing-qa', label: 'Routing QA', icon: Bot, toggleKey: 'nav.analyticsRoutingQa' },
    ],
  },
  {
    id: 'teams',
    header: 'Teams',
    defaultOpen: true,
    // Items are populated dynamically from the current user's team
    // memberships (and an admin-only "All Teams" header) inside the
    // component below — leaving this empty here keeps the static config
    // pure and lets the Sidebar handle role + membership gating in one
    // pass alongside the other sections.
    items: [],
  },
  {
    id: 'admin',
    header: 'Administration',
    items: [
      { path: '/admin/settings', label: 'Settings', icon: Settings },
      { path: '/admin/change-history', label: 'Change History', icon: History },
      { path: '/admin/user-feedback', label: 'User Feedback', icon: MessageSquareText },
      { path: '/admin/error-log', label: 'Error Log', icon: AlertOctagon },
      { path: '/admin/permissions', label: 'Permissions', icon: ShieldCheck },
    ],
  },
];

export function Sidebar() {
  const { collapsed, setCollapsed } = useSidebarState();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const userAdminRole = useAdminRole();                       // real role (drives toggle visibility)
  const effectiveAdminRole = useEffectiveAdminRole();           // gated role (drives Admin section visibility)
  const impersonating = useSyncExternalStore(subscribeToImpersonation, isImpersonatingUser);
  // Unified action-item count — the SAME number the Intake Queue's "Requires
  // action" pill shows. Both derive from useActionItems/selectActionItems so
  // the sidebar badge and the list count can no longer drift apart (the
  // recurring mismatch bug). Replaces the old pendingApprovals+myActionRequired
  // sum, which computed a different set than the list did.
  const intakeBadge = useActionableCount();
  const feedbackBadge = useNewFeedbackCount();
  const featureToggles = useEffectiveFeatureToggles();

  // Env badge label. ConfigurationProvider resolves this: pmo.environment_label
  // override first, else a match of the live environmentId against ENV_IDS
  // (legacy behavior), else null. deepLink context is initialized before the
  // provider builds config, so the value is ready here.
  const { environmentLabel: envLabel, environmentBadgeColor: envBadgeColor, brandSidebarName } = useConfig().config;

  // Current-user team memberships drive the dynamic 'teams' section.
  // useCurrentUserTeamsWithNames is already imported above (existing
  // "My Teams" debug pill consumer) and emits Set<{teamid,name}> once.
  const myTeams = useCurrentUserTeamsWithNames() ?? [];
  const isAdmin = effectiveAdminRole !== 'none';
  // Always fetch the PMO-flagged team list so non-admins can be filtered
  // down to (memberships ∩ PMO teams). Without this the sidebar shows every
  // Dataverse owner team a user belongs to — including default
  // business-unit / app-access teams that aren't on the All Teams page.
  const allTeams = useAllPmoTeams({ enabled: true }) ?? [];
  // Per-team sidebar name overrides live in pmo_appsetting under
  // `sidebar.teamName.<teamid>` -- set via Admin > Sidebar Teams when a
  // team is added. Falls back to the raw Dataverse team name when no
  // override exists.
  const { data: appSettings } = useAppSettings();
  // Active team feature packs contribute extra sidebar items (e.g. Payer
  // Initiatives' HPI link). The packs are filtered by useActiveTeamFeatures
  // — admins do NOT see these by default; they must use the per-team
  // "Act as <team> member" pill under Administration.
  const activeTeamFeatures = useActiveTeamFeatures();
  // Per-team nav-tab allowlist. null => no restriction. Admins BYPASS it so an
  // admin never loses core tabs (see filter below). Members of a team that has
  // an allowlist see only the union of allowed nav.* keys.
  const navAllowlist = useTeamTabAllowlist();
  // UAT is a Systems-Improvement-scoped surface: only SI members (or admins acting
  // as Systems Improvement) see it, in addition to the global nav.uat kill switch.
  const systemsImprovementActive = useIsSystemsImprovementActive();

  // Inject live badge count into the Intake Queue nav item, hide admin
  // for non-admins, and populate the new Teams section dynamically.
  const visibleSections = NAV_SECTIONS
    .filter((s) => s.id !== 'admin' || isAdmin)
    .map((s) => {
      if (s.id !== 'teams') {
        return {
          ...s,
          // The UAT section is gated on nav.uat (global kill switch, one-way) AND on
          // Systems Improvement membership / acting-as-SI. With nav.uat off, or when the
          // viewer is neither an SI member nor an admin acting-as-SI, no UAT item appears
          // (the empty section is then filtered out below).
          items: s.id === 'uat' && (isDemoActive() || featureToggles[UAT_TOGGLE_KEYS.nav] === false || !systemsImprovementActive)
            ? []
            : s.items.filter((item) =>
                (!item.toggleKey || featureToggles[item.toggleKey] !== false) &&
                // Allowlist: admins bypass; otherwise a nav.* item must be in the
                // team allowlist (structural items with no toggleKey stay visible).
                (isAdmin || isNavItemAllowed(navAllowlist, item.toggleKey))
              ),
        };
      }
      // Build the teams section dynamically: admins see every PMO team;
      // non-admins see the intersection of their memberships with the
      // PMO-flagged team list. Both are sorted by the admin-configured
      // drag order (pmo.sidebar_team_order); teams absent from the saved
      // array fall back to alphabetical AFTER the ordered ones.
      const savedOrderRaw = appSettings?.find((s) => s.pmo_key === SIDEBAR_TEAM_ORDER_SETTING_KEY)?.pmo_value;
      const savedOrder: string[] = (() => {
        if (!savedOrderRaw) return [];
        try { return JSON.parse(savedOrderRaw) as string[]; } catch { return []; }
      })();
      const orderIndex = (teamid: string) => {
        const i = savedOrder.indexOf(teamid);
        return i === -1 ? Infinity : i;
      };
      const sortByOrder = (a: { teamid: string; name: string }, b: { teamid: string; name: string }) => {
        const ia = orderIndex(a.teamid);
        const ib = orderIndex(b.teamid);
        if (ia !== ib) return ia - ib;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      };
      let sourceTeams: { teamid: string; name: string }[];
      if (isAdmin) {
        sourceTeams = [...allTeams].sort(sortByOrder);
      } else {
        const myIds = new Set(myTeams.map((t) => t.teamid));
        sourceTeams = allTeams.filter((t) => myIds.has(t.teamid)).sort(sortByOrder);
      }
      const teamItems: NavItem[] = sourceTeams.map((team) => ({
        path: `/teams/${team.teamid}`,
        // Admin-configured display name if set (Admin > Sidebar Teams
        // prompts on Add and offers Rename on the flagged list).
        // Otherwise the raw Dataverse team name.
        label: resolveSidebarTeamName(team.teamid, team.name, appSettings),
        icon: Users,
      }));
      return { ...s, items: teamItems };
    })
    .filter((s) => s.items.length > 0)
    .map((s) => {
      if (s.id === 'intake') {
        return {
          ...s,
          items: s.items.map((item) =>
            item.path === '/intake' ? { ...item, badge: intakeBadge } : item,
          ),
        };
      }
      if (s.id === 'admin') {
        return {
          ...s,
          items: s.items.map((item) =>
            item.path === '/admin/user-feedback' ? { ...item, badge: feedbackBadge } : item,
          ),
        };
      }
      return s;
    })
    // Splice in items contributed by active team feature packs. Each pack
    // declares `section` (matching a NavSection.id) and an optional `after`
    // path so authors can pin items next to a known sibling (e.g. HPI right
    // after /projects). Items targeting unknown sections are dropped silently.
    .map((s) => {
      const additions = activeTeamFeatures
        .flatMap((m) => m.sidebarItems)
        .filter((it) => it.section === s.id);
      if (additions.length === 0) return s;
      let items = [...s.items];
      for (const add of additions) {
        const navItem: NavItem = { path: add.path, label: add.label, icon: add.icon };
        if (add.after) {
          const idx = items.findIndex((i) => i.path === add.after);
          if (idx >= 0) {
            items = [...items.slice(0, idx + 1), navItem, ...items.slice(idx + 1)];
            continue;
          }
        }
        items.push(navItem);
      }
      return { ...s, items };
    });

  const [openSections, setOpenSections] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    NAV_SECTIONS.forEach((s) => { if (s.defaultOpen) initial.add(s.id); });
    return initial;
  });

  // The Teams section is dynamic — its items come from the user's team
  // membership query, which resolves AFTER the initial render. The lazy
  // useState initializer above ran BEFORE that query resolved, so the
  // first time Teams becomes visible we make sure it's open. Without this
  // the section appears collapsed even though defaultOpen is true.
  useEffect(() => {
    if (myTeams.length === 0 && (!isAdmin || allTeams.length === 0)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenSections((prev) => {
      if (prev.has('teams')) return prev;
      const next = new Set(prev);
      next.add('teams');
      return next;
    });
    // Run only on first transition to having visible teams items.
  }, [myTeams.length, isAdmin, allTeams.length]);

  const allItems = visibleSections.flatMap((s) => s.items);
  // Match exact path first, then prefix — prefer longer matches (e.g. /analytics/by-team over /analytics)
  const selectedPath = (() => {
    if (pathname === '/' || pathname === '/dashboard') return '/dashboard';
    const exact = allItems.find((item) => item.path === pathname);
    if (exact) return exact.path;
    // Sort by path length descending so longer prefixes match first
    const prefix = [...allItems]
      .sort((a, b) => b.path.length - a.path.length)
      .find((item) => pathname.startsWith(item.path));
    return prefix?.path ?? '';
  })();

  function toggleSection(id: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Prevent double-navigation: after a nav click ignore further clicks for
  // 400ms so a fast double-click doesn't push two route changes.
  const navCooldown = useRef(false);
  function guardedNavigate(path: string) {
    if (navCooldown.current) return;
    navCooldown.current = true;
    navigate(path);
    setTimeout(() => { navCooldown.current = false; }, 400);
  }

  function renderNavItem(item: NavItem) {
    const isActive = selectedPath === item.path;
    const Icon = item.icon;
    return (
      <button
        key={item.path}
        onClick={() => guardedNavigate(item.path)}
        title={collapsed ? item.label : undefined}
        className={cn(
          'relative w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-150',
          isActive
            ? 'bg-primary/15 text-primary font-medium'
            : 'text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent'
        )}
      >
        <span
          className={cn(
            'absolute left-0 top-1 bottom-1 w-0.5 bg-primary rounded-r-full transition-opacity duration-150',
            isActive ? 'opacity-100' : 'opacity-0',
          )}
        />
        <div className="relative shrink-0">
          <Icon className={cn('h-4 w-4', isActive ? 'text-primary' : 'text-sidebar-foreground/50')} />
          {/* Badge — always visible, positioned on icon for both collapsed and expanded */}
          {item.badge != null && item.badge > 0 && (
            <span className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-0.5 rounded-full bg-rose-500 text-[10px] font-bold text-white flex items-center justify-center leading-none">
              {item.badge > 9 ? '9+' : item.badge}
            </span>
          )}
        </div>
        <AnimatePresence>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.2 }}
              className="whitespace-nowrap overflow-hidden text-[13px] leading-none"
            >
              {item.label}
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    );
  }

  return (
    <motion.aside
      className="fixed left-0 top-0 h-screen bg-sidebar border-r border-sidebar-border z-50 flex flex-col"
      animate={{ width: collapsed ? 72 : 260 }}
      transition={{ duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {/* Logo header */}
      <div className="h-14 flex items-center px-4 border-b border-sidebar-border shrink-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg btn-brand shrink-0 glow-primary-sm">
          <span className="text-white font-bold text-sm select-none">P</span>
        </div>
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <span className="ml-3 font-bold text-foreground text-base whitespace-nowrap flex items-center gap-2">
                {brandSidebarName}
                {envLabel && (
                  <span className={cn(
                    'text-[10px] font-semibold px-1.5 py-0.5 rounded border',
                    ENV_BADGE_COLORS[envBadgeColor],
                  )}>
                    {envLabel}
                  </span>
                )}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Dashboard pinned at top */}
      {featureToggles['nav.dashboard'] && (
        <div className="px-2 pt-2 shrink-0">
          {renderNavItem({ path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard })}
        </div>
      )}

      {/* Collapsible nav sections */}
      <nav className="flex-1 overflow-y-auto py-1 px-2">
        {visibleSections.map((section) => {
          const isOpen = openSections.has(section.id);
          return (
            <div key={section.id} className="mb-0.5">
              <AnimatePresence>
                {!collapsed && (
                  <motion.button
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    onClick={() => toggleSection(section.id)}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 mt-1 text-[10px] font-semibold text-sidebar-foreground/35 uppercase tracking-widest hover:text-sidebar-foreground/60 transition-colors"
                  >
                    {section.header}
                    <ChevronDown
                      className={cn(
                        'h-3 w-3 transition-transform duration-200',
                        isOpen ? 'rotate-0' : '-rotate-90'
                      )}
                    />
                  </motion.button>
                )}
              </AnimatePresence>
              <AnimatePresence initial={false}>
                {(isOpen || collapsed) && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    {section.items.map(renderNavItem)}
                    {section.id === 'admin' && userAdminRole !== 'none' && (
                      <>
                        <ImpersonationPill collapsed={collapsed} impersonating={impersonating} />
                        <ActAsTeamMemberPills collapsed={collapsed} />
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
        {/* When impersonating, the Admin section hides entirely — keep the pill
            available so the admin can flip back. */}
        {/* My Teams debug pill - visible only in non-prod OR when impersonating. */}
        {(envLabel !== 'PROD' || impersonating) && (
          <div className="mt-2 px-1">
            <MyTeamsPill collapsed={collapsed} />
          </div>
        )}
        {impersonating && userAdminRole !== 'none' && (
          <div className="mt-2 px-1">
            <ImpersonationPill collapsed={collapsed} impersonating={impersonating} />
          </div>
        )}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-sidebar-border p-2 shrink-0">
        <button
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors text-sm"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="whitespace-nowrap text-[13px]"
              >
                Collapse
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </motion.aside>
  );
}

/**
 * Admin "act as user" pill toggle, rendered under the Administration section.
 * Real admins only. When ON, useEffectiveAdminRole() returns 'none' so the
 * rest of the app gates them like a regular user (hides Admin section, blocks
 * project edits for projects they aren't on a team for, etc.). Flip back
 * instantly — setting is per-browser via localStorage.
 */
function ImpersonationPill({ collapsed, impersonating }: { collapsed: boolean; impersonating: boolean }) {
  function toggle() {
    setImpersonatingUser(!impersonating);
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={impersonating}
      onClick={toggle}
      title={collapsed
        ? (impersonating ? 'Acting as user — click to restore admin' : 'Act as user (hide admin)')
        : undefined}
      className={cn(
        'mt-2 w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-full border text-[11px] font-medium transition-colors',
        impersonating
          ? 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25'
          : 'bg-sidebar-accent/40 border-sidebar-border text-sidebar-foreground/70 hover:bg-sidebar-accent',
      )}
    >
      <UserCog className={cn('h-3.5 w-3.5 shrink-0', impersonating ? 'text-amber-600 dark:text-amber-400' : 'text-sidebar-foreground/50')} />
      <AnimatePresence>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.2 }}
            className="whitespace-nowrap overflow-hidden text-left leading-none"
          >
            {impersonating ? 'Acting as user' : 'Act as user'}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

function MyTeamsPill({ collapsed }: { collapsed: boolean }) {
  const teams = useCurrentUserTeamsWithNames();
  const count = teams ? teams.length : 0;
  const loading = teams === undefined;

  const pill = (
    <div
      className="mt-2 w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-full border border-sidebar-border bg-sidebar-accent/30 text-[11px] font-medium text-sidebar-foreground/70 cursor-help"
    >
      <UsersIcon className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/50" />
      <AnimatePresence>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.2 }}
            className="whitespace-nowrap overflow-hidden text-left leading-none"
          >
            {loading ? 'Loading...' : `My Teams (${count})`}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs">
        {loading ? (
          <span>Loading team membership...</span>
        ) : count === 0 ? (
          <span>You are not on any teams.</span>
        ) : (
          <div className="space-y-1">
            <p className="font-semibold">Your teams ({count})</p>
            <ul className="text-left space-y-0.5">
              {teams!.map((t) => (
                <li key={t.teamid} className="text-[11px]">{t.name}</li>
              ))}
            </ul>
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
