/**
 * Type contract for a team feature pack.
 *
 * Each team that has app-side customizations registers a TeamFeatureModule
 * in teamFeatureRegistry.ts. The registry drives:
 *   - which routes get mounted (App.tsx pulls them in)
 *   - which sidebar items render (Sidebar.tsx asks the registry)
 *   - which "act as <team> member" pill appears under Administration
 *   - which slot components mount in shared host pages (intake, project)
 *
 * A pack is invisible by default. It only renders for users who are real
 * members of the team OR for admins who have flipped the per-team
 * impersonation toggle. Crucially, admins do NOT see team feature surfaces
 * by default — admin role grants administration scope, not membership.
 */
import type { ComponentType, ReactNode } from 'react';

/** Sidebar section ids in NAV_SECTIONS (Sidebar.tsx). New ids may be added there. */
export type NavSectionId = 'intake' | 'portfolio' | 'pit' | 'analytics' | 'teams' | 'admin';

export interface TeamFeatureSidebarItem {
  /** Sidebar section to insert under. */
  section: NavSectionId;
  /** Insert immediately after the item with this path. If omitted, appended last. */
  after?: string;
  /** Route path for the sidebar item — must match a registered route. */
  path: string;
  /** Display label. */
  label: string;
  /** Lucide icon component. */
  icon: ComponentType<{ className?: string }>;
}

export interface TeamFeatureRoute {
  /** Path relative to AppShell base. Examples: 'hpi', 'hpi/:id'. */
  path: string;
  element: ReactNode;
}

/**
 * Slot ids host pages expose. Components registered against a slot mount
 * inside the host page only when the active feature packs include this slot.
 *
 * Add new ids here as host pages are extended; the host page renders the
 * slot via <TeamFeatureSlot slot="..." {...props} />.
 */
export type TeamFeatureSlotId =
  | 'intake.afterTeamPicker'
  | 'project.detail.afterHeader';

/** Catch-all props bag — slot consumers cast to their own contract. */
export type SlotProps = Record<string, unknown>;

export interface TeamFeatureModule {
  /**
   * Dataverse team GUID (lowercase) this pack belongs to. Historically the
   * only match criterion — kept as the primary key for `useTeamFeatureGate`
   * and the impersonation pill store. On environments where the GUID
   * matches the current user's team the pack activates via this alone.
   */
  teamId: string;
  /**
   * Additional team NAMES that should activate this pack. Needed because AAD
   * Office Group + Security Group teams get different GUIDs in each
   * environment (DEV/UAT/PROD) even when synced from the same Azure AD
   * group. Listing the team's display names (or common variants like the
   * "Coram Finance RevCycle -" prefix used on PROD) lets the same app
   * binary work across environments without env-specific constants.
   *
   * Matching is case-insensitive and exact against the team's `name`
   * column. If ANY of the current user's team names matches ANY entry
   * here, the pack activates — same effect as GUID matching would.
   */
  teamNames?: string[];
  /** Human-readable team display name — used in the sidebar pill label. */
  displayName: string;
  /** Routes contributed under AppShell. */
  routes: TeamFeatureRoute[];
  /** Sidebar items contributed into NAV_SECTIONS. */
  sidebarItems: TeamFeatureSidebarItem[];
  /** Optional per-slot components rendered inside host pages. */
  slots?: Partial<Record<TeamFeatureSlotId, ComponentType<SlotProps>>>;
}
