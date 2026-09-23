/**
 * Wraps a feature-pack route's element so that non-eligible viewers get
 * redirected to /dashboard instead of seeing the page. Same intent as
 * AdminRoute in App.tsx, but membership-driven.
 *
 * Eligible = real member of the team OR admin acting-as the team
 * (delegated to useTeamFeatureGateStatus / useActiveTeamFeatures).
 *
 * Tri-state: while the team-membership query is still in flight we render
 * a lightweight loading shell rather than redirecting -- otherwise a fresh
 * navigation loses the race and bounces the user off the page they had
 * legitimate access to (2026-07-16 operator report: Shelina Harvey bounced
 * off /hpi despite being on the Payer Initiatives team).
 */
import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useTeamFeatureGateStatus } from './useTeamFeatureGate';

interface Props {
  teamId: string;
  children: ReactNode;
}

export function TeamFeatureRouteGate({ teamId, children }: Props) {
  const { status } = useTeamFeatureGateStatus(teamId);
  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-16 gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Loading…</span>
      </div>
    );
  }
  if (status === 'denied') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
