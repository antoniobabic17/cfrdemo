/**
 * BI Coding feature pack — registry entry.
 *
 * See app/src/features/teams/_shared/types.ts for the contract. This module
 * is consumed by teamFeatureRegistry.ts; nothing else should import it
 * directly. The pack is rendered for:
 *   - Members of the BI team, OR
 *   - Admins who have flipped the "Act as BI" pill
 *
 * Admin-only-by-policy: admin role alone does NOT activate this pack.
 *
 * T2-08 deliverables registered here:
 *   - project.detail.coding slot → ProjectCodingTab (lazy, BI-team projects only)
 *
 * No routes or sidebar items are added — the Coding surface lives inside the
 * project detail page as a tab gated by primaryTeamGuid === BI_CODING_TEAM_ID.
 * Routing is handled by ProjectDetailPage directly (same pattern as HPI tab).
 */
import { BI_CODING_TEAM_ID, BI_CODING_TEAM_NAMES, BI_CODING_DISPLAY } from './constants';
import type { TeamFeatureModule } from '../_shared/types';

const biCoding: TeamFeatureModule = {
  teamId: BI_CODING_TEAM_ID,
  teamNames: BI_CODING_TEAM_NAMES,
  displayName: BI_CODING_DISPLAY,
  routes: [],
  sidebarItems: [],
  slots: {},
};

export default biCoding;
