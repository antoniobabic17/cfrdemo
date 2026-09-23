import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Users } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { LoadingOverlay } from '../../components/common/LoadingOverlay';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { SummaryStrip } from '../../components/analytics/SummaryStrip';
import { useActiveProjects } from '../../hooks/useProjects';
import { OVERALL_HEALTH } from '../../lib/constants';
import { resolveSidebarTeamName } from '../../lib/pmoTeams';
import { useAppSettings } from '../../hooks/useAppSettings';

interface TeamData {
  team: string;
  onTrack: number;
  atRisk: number;
  offTrack: number;
  noStatus: number;
  total: number;
}

export function ByTeamPage() {
  const navigate = useNavigate();
  const { data: projects = [], isLoading, error } = useActiveProjects();
  const { data: appSettings = [] } = useAppSettings();

  const chartData: TeamData[] = useMemo(() => {
    const teamMap = new Map<string, TeamData>();
    for (const p of projects) {
      // Use the admin-configured display name so the chart bars match
      // the sidebar pills the user clicks through from.
      const rawTeamName = p['_pmo_primaryteam_value@OData.Community.Display.V1.FormattedValue'];
      const teamId = p._pmo_primaryteam_value;
      const teamName = teamId && rawTeamName
        ? resolveSidebarTeamName(teamId, rawTeamName, appSettings)
        : (rawTeamName ?? 'Unassigned');
      if (!teamMap.has(teamName)) {
        teamMap.set(teamName, { team: teamName, onTrack: 0, atRisk: 0, offTrack: 0, noStatus: 0, total: 0 });
      }
      const entry = teamMap.get(teamName)!;
      entry.total++;
      if (p.proj_overallhealth === OVERALL_HEALTH.OnTrack) entry.onTrack++;
      else if (p.proj_overallhealth === OVERALL_HEALTH.AtRisk) entry.atRisk++;
      else if (p.proj_overallhealth === OVERALL_HEALTH.OffTrack) entry.offTrack++;
      else entry.noStatus++;
    }
    return Array.from(teamMap.values()).sort((a, b) => b.total - a.total);
  }, [projects, appSettings]);

  const teamCount = chartData.length;
  const avgPerTeam = teamCount > 0 ? (projects.length / teamCount).toFixed(1) : '0';
  const teamsWithRisk = chartData.filter(t => t.atRisk > 0 || t.offTrack > 0).length;
  const chartHeight = Math.max(280, chartData.length * 48);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects by Team"
        showBack
        onBack={() => navigate('/analytics')}
        subtitle={`${projects.length} active project${projects.length !== 1 ? 's' : ''} grouped by primary team`}
      />
      <ErrorBanner error={error as Error | null} />
      {isLoading ? (
        <LoadingOverlay isLoading label="Loading..." />
      ) : chartData.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center max-w-lg">
          <Users className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm font-medium text-foreground">No project data available</p>
          <p className="text-xs text-muted-foreground mt-1">Active projects will appear here grouped by their primary team.</p>
        </div>
      ) : (
        <>
          <SummaryStrip items={[
            { label: 'Active Teams', value: teamCount },
            { label: 'Total Projects', value: projects.length },
            { label: 'Avg per Team', value: avgPerTeam },
            { label: 'Teams with Risk', value: teamsWithRisk, color: teamsWithRisk > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400' },
          ]} />

          <div className="rounded-xl border border-border bg-card p-6" style={{ height: chartHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 120, right: 20, top: 8, bottom: 8 }}>
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: 'var(--color-muted-foreground)' }}
                />
                <YAxis
                  type="category"
                  dataKey="team"
                  width={115}
                  tick={{ fontSize: 12, fill: 'var(--color-muted-foreground)' }}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-card)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    fontSize: 12,
                    color: 'var(--color-foreground)',
                  }}
                />
                <Legend
                  verticalAlign="top"
                  wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
                />
                <Bar dataKey="onTrack" name="On Track" stackId="health" fill="#10b981" radius={[0, 0, 0, 0]} />
                <Bar dataKey="atRisk" name="At Risk" stackId="health" fill="#f59e0b" />
                <Bar dataKey="offTrack" name="Off Track" stackId="health" fill="#ef4444" />
                <Bar dataKey="noStatus" name="No Status" stackId="health" fill="#94a3b8" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
