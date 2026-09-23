import { createContext, useContext, useState, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertTriangle } from 'lucide-react';
import { listSettings, type AppSetting } from '../api/appSettings.api';
import { getFileSource } from '../lib/fileSource';
import { parseAdminPrincipals, hasAnyAdminPrincipal, matchesAdminPrincipal, SETTING_ADMIN_PRINCIPALS } from '../lib/adminPrincipals';
import { primeEnvironmentConfig, type EnvironmentLabel } from '../lib/environmentConfig';
import { getCachedEnvironmentId, initDeepLinkContext } from '../lib/deepLink';
import { isDemoModeActive } from '../lib/demoMode';
import { UAT_DEFAULT_TOGGLES } from '../features/uat/lib/uatToggles';
import { isImpersonatingUser, subscribeToImpersonation } from '../lib/adminImpersonation';
import * as dv from '../lib/dataverseClient';
import { getContext } from '../lib/powerAppsContext';
import {
  ENTITY_SETS,
  PMO_TEAM_FLAG,
  TENANT_ID as COMPILE_TIME_TENANT_ID,
  SP_DOCUMENT_CATEGORIES,
  SETTING_DASHBOARD_DISPLAY_CONFIG,
  SETTING_INTAKE_TRIAGE_SIMILARITY_CONFIG,
  SETTING_NOTIFICATION_DISPLAY_CONFIG,
  SETTING_SP_DOCUMENT_CATEGORIES,
  SETTING_SP_LIBRARY_BASE_URL,
  SP_LIBRARY_BASE_URL,
  SETTING_PMO_TEAM_FIELD,
  SETTING_TENANT_ID,
  SETTING_INTAKE_ROUTING_CONFIG,
  SETTING_PRIORITIZATION_WEIGHTS,
  SETTING_PRIORITIZATION_BUDGET_TIERS,
  SETTING_MIRA_SIGNAL_THRESHOLDS,
  SETTING_FEATURE_TOGGLES,
  SETTING_BRAND_SIDEBAR_NAME,
  SETTING_BRAND_APP_TITLE,
  SETTING_BRAND_GREETING,
  DEFAULT_BRAND_SIDEBAR_NAME,
  DEFAULT_BRAND_APP_TITLE,
  type P4WEnvIds,
  type EnvBadgeColor,
} from '../lib/constants';
import { INTAKE_ROUTING_CONFIG, intakeEntriesToRoutingDomains, type RoutingDomain } from '../lib/intakeRoutingConfig';
export type { RoutingDomain };

export type AdminRole = 'none' | 'pmo_admin' | 'system_admin';

// ─── Phase 2 config interfaces (§4.6) ────────────────────────────────────────

export interface DashboardDisplayConfig {
  dueSoonDays: number;
  needsAttentionLimit: number;
  recentIntakeLimit: number;
  urgentDayThreshold: number;
  warningDayThreshold: number;
}

export interface IntakeTriageSimilarityConfig {
  lookbackDays: number;
  minScore: number;
  topN: number;
}

export interface NotificationDisplayConfig {
  pollIntervalMs: number;
  categoryLabels: Record<string, string>;
  categoryColors: Record<string, string>;
}

export interface PrioritizationWeights {
  strategicPriority: number;
  complexity: number;
  health: number;
  budget: number;
  progress: number;
}

export interface BudgetTier {
  minAmount: number;
  score: number;
}

export interface MiraSignalThresholds {
  riskCountWarn: number;
  riskCountCritical: number;
  riskScoreWarn: number;
  riskScoreCritical: number;
}

export interface FeatureToggles {
  [key: string]: boolean;
}

export interface RuntimeConfig {
  dashboardDisplay: DashboardDisplayConfig;
  intakeTriageSimilarity: IntakeTriageSimilarityConfig;
  notificationDisplay: NotificationDisplayConfig;
  spDocumentCategories: string[];
  spLibraryBaseUrl: string;
  pmoTeamField: string;
  tenantId: string;
  intakeRoutingConfig: RoutingDomain[];
  prioritizationWeights: PrioritizationWeights;
  prioritizationBudgetTiers: BudgetTier[];
  miraSignalThresholds: MiraSignalThresholds;
  featureToggles: FeatureToggles;
  /** Sidebar env badge. Override pmo.environment_label; else ENV_IDS match; else null. */
  environmentLabel: EnvironmentLabel | null;
  /** P4W env-pinned GUIDs. Override pmo.p4w_env_guids_json; else P4W_GUIDS_BY_ENV; else undefined. */
  p4wEnvGuids: P4WEnvIds | undefined;
  /** Sidebar env badge palette. Override pmo.environment_badge_color; else label-derived. */
  environmentBadgeColor: EnvBadgeColor;
  /** Sidebar brand text. Override pmo.brand_sidebar_name; else 'CFR PMO'. */
  brandSidebarName: string;
  /** Header banner title. Override pmo.brand_app_title; else 'CFR Project Management'. */
  brandAppTitle: string;
  /** Fixed greeting override. Override pmo.brand_greeting; blank -> time-based. */
  brandGreeting: string;
}

// ─── Compile-time defaults ────────────────────────────────────────────────────

export const DEFAULT_DASHBOARD_DISPLAY: DashboardDisplayConfig = {
  dueSoonDays: 30,
  needsAttentionLimit: 6,
  recentIntakeLimit: 7,
  urgentDayThreshold: 0,
  warningDayThreshold: 7,
};

export const DEFAULT_INTAKE_TRIAGE_SIMILARITY: IntakeTriageSimilarityConfig = {
  lookbackDays: 90,
  minScore: 0.1,
  topN: 3,
};

export const DEFAULT_NOTIFICATION_DISPLAY: NotificationDisplayConfig = {
  pollIntervalMs: 60000,
  categoryLabels: {},
  categoryColors: {},
};

export const DEFAULT_INTAKE_ROUTING_CONFIG: RoutingDomain[] = intakeEntriesToRoutingDomains(INTAKE_ROUTING_CONFIG);

export const DEFAULT_PRIORITIZATION_WEIGHTS: PrioritizationWeights = {
  strategicPriority: 35,
  complexity: 20,
  health: 15,
  budget: 15,
  progress: 15,
};

export const DEFAULT_PRIORITIZATION_BUDGET_TIERS: BudgetTier[] = [
  { minAmount: 500000, score: 100 },
  { minAmount: 100000, score: 70 },
  { minAmount: 25000, score: 40 },
];

export const DEFAULT_MIRA_SIGNAL_THRESHOLDS: MiraSignalThresholds = {
  riskCountWarn: 2,
  riskCountCritical: 4,
  riskScoreWarn: 6,
  riskScoreCritical: 10,
};

export const DEFAULT_FEATURE_TOGGLES: FeatureToggles = {
  'nav.dashboard': true,
  'nav.intakeQueue': true,
  'nav.projects': true,
  'nav.programs': true,
  'nav.statusReports': true,
  'nav.analyticsOverview': true,
  'nav.analyticsByTeam': true,
  'nav.analyticsPipeline': true,
  'nav.analyticsHealth': true,
  'nav.analyticsSchedule': true,
  'nav.analyticsGovernance': true,
  'nav.analyticsCapacity': true,
  'nav.analyticsPrioritization': true,
  'nav.analyticsFinancials': true,
  'nav.analyticsScenarios': true,
  'nav.analyticsVariance': true,
  'nav.analyticsRoadmap': true,
  'nav.analyticsIntakePipeline': true,
  'nav.analyticsRoutingQa': true,
  'header.themeToggle': true,
  'header.shortcuts': true,
  'header.askMira': true,
  // Intake screen request cards (matched by workflow name; feedback by route)
  'intakeCard.programIntake5Stage': true,    // "Standard Program Intake (5-Stage)"
  'intakeCard.programRequest': true,          // "Standard Program Request"
  'intakeCard.projectIntake5Stage': true,    // "Standard Project Intake (5-Stage)"
  'intakeCard.projectRequest': true,          // "Standard Project Request"
  'intakeCard.feedbackBug': true,             // Report a Bug
  'intakeCard.feedbackEnhancement': true,     // Suggest an Enhancement
  // Intake flow behavior
  // When true, intake submission auto-approves AND converts the request to a
  // project/program in one shot (provided validateConversionReadiness passes).
  // When false (default), submission goes through the normal approval queue.
  'intake.bypassApproval': false,
  // Project detail page tabs
  'projectTab.overview': true,
  'projectTab.plan': true,
  'projectTab.tasks': true,
  'projectTab.monitor': true,
  'projectTab.govern': true,
  'projectTab.collaborate': true,
  'projectTab.status': true,
  // UAT Manager (spec 001). Spread from the feature's own module so the seven
  // keys are declared in exactly one place. ALL TRUE because G-ENABLE was
  // answered opt-out-by-team -- "everyone, unless a team opts out" -- not opt-in.
  ...UAT_DEFAULT_TOGGLES,
};

// ─── Parsing ──────────────────────────────────────────────────────────────────

function parseJson<T>(value: string | undefined, key: string, fallback: T): { value: T; malformed: boolean } {
  if (!value) return { value: fallback, malformed: false };
  try {
    return { value: JSON.parse(value) as T, malformed: false };
  } catch (e) {
    console.warn(`[ConfigurationProvider] Failed to parse setting "${key}":`, e);
    return { value: fallback, malformed: true };
  }
}

function buildRuntimeConfig(settings: AppSetting[], environmentId: string | null): { config: RuntimeConfig; malformedKeys: Set<string> } {
  const map = Object.fromEntries(settings.map((s) => [s.pmo_key, s.pmo_value]));
  const malformedKeys = new Set<string>();
  const { environmentLabel, p4wEnvGuids, environmentBadgeColor } = primeEnvironmentConfig(settings, environmentId);

  function parse<T>(key: string, fallback: T): T {
    const result = parseJson<T>(map[key] ?? undefined, key, fallback);
    if (result.malformed) malformedKeys.add(key);
    return result.value;
  }

  const config: RuntimeConfig = {
    dashboardDisplay: parse(SETTING_DASHBOARD_DISPLAY_CONFIG, DEFAULT_DASHBOARD_DISPLAY),
    intakeTriageSimilarity: parse(SETTING_INTAKE_TRIAGE_SIMILARITY_CONFIG, DEFAULT_INTAKE_TRIAGE_SIMILARITY),
    notificationDisplay: parse(SETTING_NOTIFICATION_DISPLAY_CONFIG, DEFAULT_NOTIFICATION_DISPLAY),
    spDocumentCategories: parse(SETTING_SP_DOCUMENT_CATEGORIES, [...SP_DOCUMENT_CATEGORIES]),
    spLibraryBaseUrl: map[SETTING_SP_LIBRARY_BASE_URL] || SP_LIBRARY_BASE_URL,
    pmoTeamField: map[SETTING_PMO_TEAM_FIELD] || PMO_TEAM_FLAG,
    tenantId: map[SETTING_TENANT_ID] || COMPILE_TIME_TENANT_ID,
    intakeRoutingConfig: parse(SETTING_INTAKE_ROUTING_CONFIG, DEFAULT_INTAKE_ROUTING_CONFIG),
    prioritizationWeights: parse(SETTING_PRIORITIZATION_WEIGHTS, DEFAULT_PRIORITIZATION_WEIGHTS),
    prioritizationBudgetTiers: parse(SETTING_PRIORITIZATION_BUDGET_TIERS, DEFAULT_PRIORITIZATION_BUDGET_TIERS),
    miraSignalThresholds: parse(SETTING_MIRA_SIGNAL_THRESHOLDS, DEFAULT_MIRA_SIGNAL_THRESHOLDS),
    featureToggles: parse(SETTING_FEATURE_TOGGLES, DEFAULT_FEATURE_TOGGLES),
    environmentLabel,
    p4wEnvGuids,
    environmentBadgeColor,
    brandSidebarName: map[SETTING_BRAND_SIDEBAR_NAME] || DEFAULT_BRAND_SIDEBAR_NAME,
    brandAppTitle: map[SETTING_BRAND_APP_TITLE] || DEFAULT_BRAND_APP_TITLE,
    brandGreeting: map[SETTING_BRAND_GREETING] || '',
  };

  return { config, malformedKeys };
}

// ─── Role resolution ──────────────────────────────────────────────────────────

const ADMIN_ROLE_CACHE_KEY = 'pmo.adminRole.v1';
const ADMIN_ROLE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min -- safe, role changes require deliberate admin action

async function resolveAdminRole(): Promise<AdminRole> {
  if (isDemoModeActive()) return 'system_admin';
  // Return the cached role instantly if still fresh. Eliminates 3-4 sequential
  // Dataverse round-trips (getContext + systemuser lookup + roles query +
  // admin_principals check) on every page load, which is the dominant startup
  // bottleneck on a slow connection. Safe: role is already resolved once per
  // session mount and never re-polled; this just persists that result across reloads.
  try {
    const cached = sessionStorage.getItem(ADMIN_ROLE_CACHE_KEY);
    if (cached) {
      const { role, ts } = JSON.parse(cached) as { role: AdminRole; ts: number };
      if (Date.now() - ts < ADMIN_ROLE_CACHE_TTL_MS) return role;
    }
  } catch { /* sessionStorage unavailable -- fall through to live resolve */ }

  function cacheAndReturn(role: AdminRole): AdminRole {
    try { sessionStorage.setItem(ADMIN_ROLE_CACHE_KEY, JSON.stringify({ role, ts: Date.now() })); } catch { /* ignore */ }
    return role;
  }

  try {
    // Resolve the Dataverse systemuserid. Canvas code apps don't have Xrm, so
    // we use the Power Apps SDK to get the AAD objectId then look up the systemuser.
    let userId: string | null = null;
    let aadObjectId: string | undefined;

    try {
      const ctx = await getContext();
      aadObjectId = (ctx.user as Record<string, unknown>).objectId as string | undefined;
      if (aadObjectId) {
        const users = await dv.list<{ systemuserid: string }>(ENTITY_SETS.systemUser, {
          $select: ['systemuserid'],
          $filter: `azureactivedirectoryobjectid eq '${aadObjectId}'`,
        });
        userId = users[0]?.systemuserid ?? null;
      }
    } catch {
      // getContext not available (dev mode)
    }

    // Fallback: Xrm host (model-driven app hosting — not used in canvas code apps)
    if (!userId) {
      const xrmId = dv.getCurrentUserId();
      if (xrmId !== 'anonymous') userId = xrmId;
    }

    if (!userId) return cacheAndReturn('none');

    // Include roles assigned both directly to the user AND via teams the user belongs to.
    // IT security policy requires AD-team-based assignment (audited via AAD security groups);
    // direct user-role assignments are an exception, not the norm.
    const roles = await dv.list<{ name: string }>(ENTITY_SETS.role, {
      $select: ['name'],
      $filter:
        `systemuserroles_association/any(u: u/systemuserid eq '${userId}')` +
        ` or ` +
        `teamroles_association/any(t: t/teammembership_association/any(u: u/systemuserid eq '${userId}'))`,
    });
    const names = new Set(roles.map((r) => r.name));
    if (names.has('System Administrator')) return cacheAndReturn('system_admin');
    if (names.has('CFR PMO Administrator') || names.has('PMO Administrator')) return cacheAndReturn('pmo_admin');

    // Configurable admin identity (initiative #4). ADDITIVE: only grants extra
    // admins, never removes the role-name admins above. Matches the caller's AAD
    // object id or any team they belong to against pmo.admin_principals_json.
    // (Group-object-id matching is not available client-side here; user + team
    // axes are checked. See lib/adminPrincipals.ts.)
    try {
      const rows = await dv.list<{ pmo_value: string | null }>(ENTITY_SETS.appSetting, {
        $select: ['pmo_value'],
        $filter: `pmo_key eq '${SETTING_ADMIN_PRINCIPALS}' and statecode eq 0`,
      });
      const principals = parseAdminPrincipals(rows[0]?.pmo_value ?? undefined);
      if (hasAnyAdminPrincipal(principals)) {
        let teamIds: string[] = [];
        if (principals.teamIds.length > 0) {
          const teams = await dv.list<{ teamid: string }>(ENTITY_SETS.team, {
            $select: ['teamid'],
            $filter: `teammembership_association/any(u: u/systemuserid eq '${userId}')`,
          });
          teamIds = teams.map((t) => t.teamid);
        }
        if (matchesAdminPrincipal(principals, aadObjectId, teamIds)) return cacheAndReturn('pmo_admin');
      }
    } catch {
      // principals lookup failed — fall through; role-name result stands.
    }

    return cacheAndReturn('none');
  } catch {
    return cacheAndReturn('none');
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface ConfigurationContextValue {
  settings: AppSetting[];
  userAdminRole: AdminRole;
  settingsFailed: boolean;
  config: RuntimeConfig;
  malformedKeys: Set<string>;
}

const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  dashboardDisplay: DEFAULT_DASHBOARD_DISPLAY,
  intakeTriageSimilarity: DEFAULT_INTAKE_TRIAGE_SIMILARITY,
  notificationDisplay: DEFAULT_NOTIFICATION_DISPLAY,
  spDocumentCategories: [...SP_DOCUMENT_CATEGORIES],
  spLibraryBaseUrl: SP_LIBRARY_BASE_URL,
  pmoTeamField: PMO_TEAM_FLAG,
  tenantId: COMPILE_TIME_TENANT_ID,
  intakeRoutingConfig: DEFAULT_INTAKE_ROUTING_CONFIG,
  prioritizationWeights: DEFAULT_PRIORITIZATION_WEIGHTS,
  prioritizationBudgetTiers: DEFAULT_PRIORITIZATION_BUDGET_TIERS,
  miraSignalThresholds: DEFAULT_MIRA_SIGNAL_THRESHOLDS,
  featureToggles: DEFAULT_FEATURE_TOGGLES,
  environmentLabel: null,
  p4wEnvGuids: undefined,
  environmentBadgeColor: 'emerald',
  brandSidebarName: DEFAULT_BRAND_SIDEBAR_NAME,
  brandAppTitle: DEFAULT_BRAND_APP_TITLE,
  brandGreeting: '',
};

const ConfigurationContext = createContext<ConfigurationContextValue>({
  settings: [],
  userAdminRole: 'none',
  settingsFailed: false,
  config: DEFAULT_RUNTIME_CONFIG,
  malformedKeys: new Set(),
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ConfigurationProvider({ children }: { children: ReactNode }) {
  const {
    data: settings = [],
    isLoading: settingsLoading,
    isError: settingsFailed,
  } = useQuery({
    queryKey: ['appSettings'],
    queryFn: listSettings,
    staleTime: 5 * 60 * 1000,
    retry: false,
    // This query also gates whether `children` (and therefore every other
    // ['appSettings'] observer, e.g. useAppSettings() in Sidebar) mounts at
    // all. TanStack Query's shouldLoadOnMount() retries an errored,
    // never-succeeded query (dataUpdatedAt === 0) on every NEW subscriber,
    // regardless of refetchOnMount -- only retryOnMount:false suppresses
    // that specific case. Without both, this becomes a self-sustaining
    // loop: gate clears on error -> Sidebar mounts -> its own
    // useAppSettings() observer re-fetches on subscribe -> isLoading flips
    // true -> gate closes -> Sidebar unmounts -> the in-flight fetch
    // (uncancelled) eventually errors -> gate clears again -> repeat
    // forever. Explicit invalidateQueries calls (see useAppSettings.ts's
    // useUpsertSetting, AdminSettingsPage.tsx) already cover every
    // legitimate refresh path.
    refetchOnMount: false,
    retryOnMount: false,
  });

  const [userAdminRole, setUserAdminRole] = useState<AdminRole>('none');
  const [roleResolved, setRoleResolved] = useState(false);
  // Ensure the Power Apps host context (environmentId) is cached BEFORE we build
  // config, so environment-identity resolution (env label, P4W GUIDs) can match
  // the live environmentId. Previously each consumer initialized this itself.
  const [envResolved, setEnvResolved] = useState(false);

  useEffect(() => {
    resolveAdminRole().then((role) => {
      setUserAdminRole(role);
      setRoleResolved(true);
    });
    initDeepLinkContext().finally(() => setEnvResolved(true));
  }, []);

  if (settingsLoading || !roleResolved || !envResolved) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
      </div>
    );
  }

  const { config, malformedKeys } = buildRuntimeConfig(settings, getCachedEnvironmentId());
  // Prime the file-source module cache from settings so non-React upload
  // utilities (getCachedFileSource) honor the pmo.file_source flag. This is
  // the only read-side consumer of the flag, so without it the cache stays at
  // its 'dataverse' default and every upload skips SharePoint.
  getFileSource(settings);

  return (
    <ConfigurationContext.Provider value={{ settings, userAdminRole, settingsFailed, config, malformedKeys }}>
      {settingsFailed && (
        <div className="fixed top-0 inset-x-0 z-[60] flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Application settings could not be loaded. Using default values. Reload the page to retry.
        </div>
      )}
      {children}
    </ConfigurationContext.Provider>
  );
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useConfig(): ConfigurationContextValue {
  return useContext(ConfigurationContext);
}

export function useAdminRole(): AdminRole {
  return useContext(ConfigurationContext).userAdminRole;
}

/**
 * Admin role after applying the per-session "act as user" impersonation
 * toggle. When an admin flips the sidebar pill, this hook reports 'none' so
 * the rest of the app gates them as a regular user.
 *
 * Use this hook for all UI gating. Use useAdminRole() only when you need the
 * real underlying role (e.g. to decide whether to show the impersonation
 * toggle itself).
 */
export function useEffectiveAdminRole(): AdminRole {
  const realRole = useAdminRole();
  const impersonating = useSyncExternalStore(subscribeToImpersonation, isImpersonatingUser);
  if (impersonating && realRole !== 'none') return 'none';
  return realRole;
}

export function usePmoTeamField(): string {
  return useContext(ConfigurationContext).config.pmoTeamField;
}

export function useTenantId(): string {
  return useContext(ConfigurationContext).config.tenantId;
}

export function useIntakeRoutingConfig(): RoutingDomain[] {
  return useContext(ConfigurationContext).config.intakeRoutingConfig;
}

export function usePrioritizationWeights(): PrioritizationWeights {
  return useContext(ConfigurationContext).config.prioritizationWeights;
}

export function usePrioritizationBudgetTiers(): BudgetTier[] {
  return useContext(ConfigurationContext).config.prioritizationBudgetTiers;
}

export function useMiraSignalThresholds(): MiraSignalThresholds {
  return useContext(ConfigurationContext).config.miraSignalThresholds;
}

export function useFeatureToggles(): FeatureToggles {
  return useContext(ConfigurationContext).config.featureToggles;
}

export function useFeatureToggle(key: string): boolean {
  const toggles = useFeatureToggles();
  return toggles[key] ?? true;
}
