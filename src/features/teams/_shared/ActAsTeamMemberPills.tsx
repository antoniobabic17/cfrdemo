/**
 * ActAsTeamMemberPills — admin-only sidebar block.
 *
 * One pill per registered team feature pack. Toggling a pill flips the
 * per-team impersonation flag for that team only — adds the pack's
 * routes, sidebar items, and slot extensions to the current admin's
 * session. Independent of the global "Act as user" pill, which removes
 * admin scope entirely.
 *
 * Hidden for non-admins — they get pack content via real membership and
 * don't need an impersonation toggle.
 *
 * APP/TENANT-SPECIFIC: the team feature packs these pills expose (Payer
 * Initiatives, BI Coding, Process & Project) are custom to THIS app + tenant —
 * not part of the generic/transferable core. A caption below notes this.
 */
import { useSyncExternalStore } from 'react';
import { isDemoActive } from '../../../lib/demoMode';
import { motion, AnimatePresence } from 'framer-motion';
import { Users } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useEffectiveAdminRole } from '../../../providers/ConfigurationProvider';
import { listAllTeamFeatures } from './teamFeatureRegistry';
import {
  isActingAsTeamMember,
  setActingAsTeamMember,
  subscribeToTeamImpersonation,
} from './teamImpersonation';
import {
  SYSTEMS_IMPROVEMENT_TEAM_ID,
  SYSTEMS_IMPROVEMENT_DISPLAY,
} from '../systems-improvement/constants';

interface Props {
  collapsed: boolean;
}

export function ActAsTeamMemberPills({ collapsed }: Props) {
  const adminRole = useEffectiveAdminRole();
  // Re-render when any pill is toggled. Snapshot string is stable when
  // toggle states haven't changed so React bails out of unnecessary work.
  const snapshot = useSyncExternalStore(subscribeToTeamImpersonation, () =>
    [...listAllTeamFeatures().map((m) => m.teamId), SYSTEMS_IMPROVEMENT_TEAM_ID]
      .map((id) => `${id}:${isActingAsTeamMember(id) ? 1 : 0}`)
      .join('|'),
  );
  void snapshot;

  // Demo mode: team-feature pills expose Payer Initiatives/BI Coding/Process &
  // Project which are hardcoded to real-tenant GUIDs with no demo data — every
  // route they unlock renders empty. Hide them in demo entirely.
  if (isDemoActive()) return null;
  if (adminRole === 'none') return null;
  const features = listAllTeamFeatures();

  return (
    <div className="mt-1 space-y-1">
      <AnimatePresence>
        {!collapsed && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="px-2.5 pt-2 text-[10px] font-semibold text-sidebar-foreground/35 uppercase tracking-widest"
          >
            Act as Team Member
          </motion.p>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {!collapsed && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="px-2.5 text-[9px] text-sidebar-foreground/30 leading-tight"
          >
            Specific to this app/tenant
          </motion.p>
        )}
      </AnimatePresence>
      {features.map((m) => (
        <ActAsTeamMemberPill key={m.teamId} teamId={m.teamId} label={m.displayName} collapsed={collapsed} />
      ))}
      {/* Systems Improvement is not a routed feature pack, but UAT visibility is
          gated on it the same way — expose an act-as pill so admins can preview UAT. */}
      <ActAsTeamMemberPill
        key={SYSTEMS_IMPROVEMENT_TEAM_ID}
        teamId={SYSTEMS_IMPROVEMENT_TEAM_ID}
        label={SYSTEMS_IMPROVEMENT_DISPLAY}
        collapsed={collapsed}
      />
    </div>
  );
}

function ActAsTeamMemberPill({
  teamId, label, collapsed,
}: { teamId: string; label: string; collapsed: boolean }) {
  const on = isActingAsTeamMember(teamId);
  function toggle() { setActingAsTeamMember(teamId, !on); }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={toggle}
      title={collapsed
        ? (on ? `Acting as ${label} member — click to stop` : `Act as ${label} member`)
        : undefined}
      className={cn(
        'w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-full border text-[11px] font-medium transition-colors',
        on
          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25'
          : 'bg-sidebar-accent/40 border-sidebar-border text-sidebar-foreground/70 hover:bg-sidebar-accent',
      )}
    >
      <Users className={cn('h-3.5 w-3.5 shrink-0', on ? 'text-emerald-600 dark:text-emerald-400' : 'text-sidebar-foreground/50')} />
      <AnimatePresence>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.2 }}
            className="whitespace-nowrap overflow-hidden text-left leading-none truncate"
          >
            {on ? `Acting as ${label}` : `Act as ${label}`}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}
