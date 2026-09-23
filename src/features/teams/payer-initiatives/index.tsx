/**
 * Payer Initiatives feature pack — registry entry.
 *
 * See app/src/features/teams/_shared/types.ts for the contract. This module
 * is consumed by teamFeatureRegistry.ts; nothing else should import it
 * directly. The pack is rendered for:
 *   - Members of the Payer Initiatives team, OR
 *   - Admins who have flipped the "Act as Payer Initiatives" pill
 *
 * Admin-only-by-policy: admin role alone does NOT activate this pack.
 */
import { Tag, AlertTriangle } from 'lucide-react';
import { HpiGallery } from './components/HpiGallery';
import { PayerIssuesGallery } from './components/PayerIssuesGallery';
import { PAYER_INITIATIVES_TEAM_ID, PAYER_INITIATIVES_TEAM_NAMES, PAYER_INITIATIVES_DISPLAY } from './constants';
import type { TeamFeatureModule } from '../_shared/types';

// HPI on intake moved into GovernedIntakeWizard's Project Setup stage,
// gated by the SELECTED Primary Team rather than viewer membership.
// The 'intake.afterTeamPicker' slot was removed from this registry; see
// app/src/pages/Intake/GovernedIntakeWizard.tsx HpiIssueField + the
// extras.hpiIssueId field key in app/src/lib/intakeExtras.ts.
const payerInitiatives: TeamFeatureModule = {
  teamId: PAYER_INITIATIVES_TEAM_ID,
  teamNames: PAYER_INITIATIVES_TEAM_NAMES,
  displayName: PAYER_INITIATIVES_DISPLAY,
  routes: [
    { path: 'hpi', element: <HpiGallery /> },
    { path: 'hpi/:id', element: <HpiGallery /> },
    { path: 'payer-issues', element: <PayerIssuesGallery /> },
    { path: 'payer-issues/:id', element: <PayerIssuesGallery /> },
  ],
  sidebarItems: [
    {
      // HPI + Payer Inquiries now live in their own collapsible "PIT" sidebar
      // group instead of under Portfolio. The PIT group is otherwise empty, so it
      // only appears for PI members / admins acting-as-PI (same gating as before).
      section: 'pit',
      path: '/hpi',
      label: 'HPI',
      icon: Tag,
    },
    {
      section: 'pit',
      after: '/hpi',
      path: '/payer-issues',
      label: 'Payer Inquiries',
      icon: AlertTriangle,
    },
  ],
  // No slots registered — HPI and Payer Issues are now first-class tabs
  // on ProjectDetailPage gated by the project's Primary Team rather than
  // the viewer's team membership. The previous project.detail.afterHeader
  // badge has been removed.
  slots: {},
};

export default payerInitiatives;
