/**
 * Admin > Permissions.
 *
 * Two panels:
 *   1. Monthly Unique Users -- bar chart + drill-through user list.
 *      Data source: pmo_telemetryevent pmo_eventtype='SessionPing'.
 *      Aggregated client-side (COUNT DISTINCT by systemuserid per month)
 *      because the Web API doesn't do DISTINCT natively.
 *   2. User permissions viewer -- pick a systemuser, see every project
 *      they can edit categorized by reason (Admin / PM / ExecSponsor /
 *      Manager / Primary Team Lead / Primary Team member / Collaborator
 *      Full / Collaborator Tasks+Notes) with the effective scope.
 *
 * Read-only page. Never mutates. Gated by the AdminRoute wrapper in
 * App.tsx so only users with an effective admin role can reach it.
 */
import { useMemo, useState } from 'react';
import { useDataSource } from '../../lib/taskSource';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, LabelList } from 'recharts';
import { Loader2, ShieldCheck, Users } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { SearchableSelect, type SelectOption } from '../../components/common/SearchableSelect';
import { Badge } from '../../components/ui/badge';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import * as dv from '../../lib/dataverseClient';
import {
  fetchMonthlyUniqueUsers,
  fetchUserProjectPermissions,
  resolveUserTeams,
  reasonLabel,
  type PermissionReason,
  type EffectiveScope,
  type MonthlyBucket,
} from '../../api/permissions.api';
import { useAllPmoTeams } from '../../hooks/useAllPmoTeams';
import { usePmoTeamField } from '../../providers/ConfigurationProvider';

interface UserRow {
  systemuserid: string;
  fullname: string;
}

async function searchUsers(query: string): Promise<SelectOption[]> {
  const safe = query.replace(/'/g, "''");
  const rows = await dv.list<UserRow>('systemusers', {
    $select: ['systemuserid', 'fullname'],
    $filter: `contains(fullname,'${safe}') and isdisabled eq false`,
    $orderby: 'fullname asc',
    $top: 50,
  });
  return rows.map((u) => ({ value: u.systemuserid, label: u.fullname }));
}

async function resolveUserLabel(id: string): Promise<string> {
  if (!id) return '';
  try {
    const u = await dv.get<{ fullname?: string }>('systemusers', id, ['fullname']);
    return u.fullname ?? '';
  } catch {
    return '';
  }
}

async function resolveUserNames(
  userIds: string[],
  seed: Record<string, string | null> = {},
): Promise<Record<string, string>> {
  if (userIds.length === 0) return {};
  // Seed with names already carried on the SessionPing payload -- these
  // are authoritative and cheap. Only round-trip to Dataverse for the ids
  // that don't have a name yet.
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const id of userIds) {
    const seeded = seed[id.toLowerCase()];
    if (seeded && seeded.trim()) out[id.toLowerCase()] = seeded;
    else missing.push(id);
  }
  if (missing.length === 0) return out;
  const chunks: string[][] = [];
  for (let i = 0; i < missing.length; i += 50) chunks.push(missing.slice(i, i + 50));
  for (const chunk of chunks) {
    const filter = chunk.map((id) => `systemuserid eq ${id}`).join(' or ');
    const rows = await dv.list<UserRow>('systemusers', {
      $select: ['systemuserid', 'fullname'],
      $filter: filter,
    });
    for (const r of rows) out[r.systemuserid.toLowerCase()] = r.fullname ?? r.systemuserid;
  }
  return out;
}

function scopePill(scope: EffectiveScope): { label: string; className: string } {
  if (scope === 'full') return { label: 'Full access', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' };
  if (scope === 'tasks-and-notes') return { label: 'Tasks + Notes', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200' };
  return { label: 'Read-only', className: 'bg-muted text-muted-foreground' };
}

// ── Chart panel ──────────────────────────────────────────────────────────

const DRILL_VISIBLE_CAP = 25;

function MonthlyUniqueUsersPanel() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['permissions', 'monthly-unique-users'] as const,
    queryFn: () => fetchMonthlyUniqueUsers(12),
    // Always refetch when the admin opens this page. The chart is a live
    // metric and the SessionPing rows land asynchronously; a stale cached
    // "empty" result would mislead the admin about who's used the app.
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [drillQuery, setDrillQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState('');

  const selectedBucket: MonthlyBucket | undefined =
    selectedMonth ? data?.find((b) => b.month === selectedMonth) : undefined;

  const { data: nameMap } = useQuery({
    queryKey: ['permissions', 'monthly-drill', selectedMonth] as const,
    enabled: !!selectedBucket && selectedBucket.userIds.length > 0,
    queryFn: () => resolveUserNames(selectedBucket!.userIds, selectedBucket!.userNames),
    staleTime: 5 * 60 * 1000,
  });

  // Resolve which PMO teams each user belongs to (for the team filter).
  // Pass the runtime pmoTeamField so the query uses the correct column per env.
  const pmoTeamField = usePmoTeamField();
  const { data: teamMap } = useQuery({
    queryKey: ['permissions', 'monthly-drill-teams', selectedMonth, pmoTeamField] as const,
    enabled: !!selectedBucket && selectedBucket.userIds.length > 0 && !!pmoTeamField,
    queryFn: () => resolveUserTeams(selectedBucket!.userIds, pmoTeamField),
    staleTime: 5 * 60 * 1000,
  });

  // All PMO teams for the dropdown labels.
  const allPmoTeams = useAllPmoTeams({ enabled: true });

  // Filter the drill-through list by the search box. Match against the
  // resolved fullname (falling back to the id when name isn't yet loaded)
  // so results are usable even before the name-resolve query lands.
  const filteredUserIds = useMemo(() => {
    if (!selectedBucket) return [];
    const q = drillQuery.trim().toLowerCase();
    return selectedBucket.userIds.filter((id) => {
      const idLc = id.toLowerCase();
      if (q) {
        const name = nameMap?.[idLc] ?? id;
        if (!name.toLowerCase().includes(q)) return false;
      }
      if (teamFilter) {
        const userTeams = teamMap?.[idLc] ?? [];
        if (!userTeams.includes(teamFilter)) return false;
      }
      return true;
    });
  }, [selectedBucket, drillQuery, nameMap, teamFilter, teamMap]);

  const visibleUserIds = filteredUserIds.slice(0, DRILL_VISIBLE_CAP);
  const hiddenCount = filteredUserIds.length - visibleUserIds.length;

  if (isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }
  if (error) return <ErrorBanner error={error as Error} />;
  if (!data || data.length === 0) return <p className="text-sm text-muted-foreground italic">No session data yet — the metric populates as team members open the app.</p>;

  const total = data.reduce((s, m) => s + m.distinctUsers, 0);
  const avg = total / data.length;

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <header className="flex items-baseline justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Monthly Unique Users</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Distinct users who opened the app each month (last 12 months). Click a bar to see who.</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tabular-nums leading-none">{data[data.length - 1]?.distinctUsers ?? 0}</p>
          <p className="text-[10px] text-muted-foreground">This month · avg {avg.toFixed(1)}/mo</p>
        </div>
      </header>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <XAxis dataKey="month" tick={{ fontSize: 10 }} interval={0} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <RechartsTooltip
              formatter={(value: number) => [value, 'Users']}
              contentStyle={{ fontSize: 12, borderRadius: 6 }}
            />
            <Bar dataKey="distinctUsers" fill="#3b82f6" cursor="pointer" onClick={(entry: unknown) => {
              const bucket = entry as { payload?: MonthlyBucket };
              const m = bucket?.payload?.month;
              if (m) {
                setSelectedMonth((prev) => (prev === m ? null : m));
                setDrillQuery('');
                setTeamFilter('');
              }
            }}>
              <LabelList dataKey="distinctUsers" position="top" style={{ fontSize: 10, fill: 'var(--foreground)' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {selectedBucket && (
        <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Users active in {selectedBucket.month} ({selectedBucket.distinctUsers})
          </p>
          {selectedBucket.userIds.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">Nobody pinged that month.</p>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  type="search"
                  value={drillQuery}
                  onChange={(e) => setDrillQuery(e.target.value)}
                  placeholder={`Search ${selectedBucket.distinctUsers} active user${selectedBucket.distinctUsers === 1 ? '' : 's'}…`}
                  className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <select
                  value={teamFilter}
                  onChange={(e) => setTeamFilter(e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">All Teams</option>
                  {allPmoTeams?.map((team: { teamid: string; name: string }) => (
                    <option key={team.teamid} value={team.teamid}>{team.name}</option>
                  ))}
                </select>
              </div>
              {filteredUserIds.length === 0 ? (
                <p className="text-xs italic text-muted-foreground">No matches for “{drillQuery}”.</p>
              ) : (
                <>
                  <ul className="text-xs text-foreground space-y-0.5">
                    {visibleUserIds.map((id) => (
                      <li key={id}>{nameMap?.[id.toLowerCase()] ?? id}</li>
                    ))}
                  </ul>
                  {hiddenCount > 0 && (
                    <p className="text-[10px] text-muted-foreground italic">
                      Showing {visibleUserIds.length} of {filteredUserIds.length}
                      {drillQuery ? ' matches' : ''} · refine the search to narrow the list.
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ── User permissions viewer ──────────────────────────────────────────────

function UserPermissionsViewer() {
  const [userId, setUserId] = useState('');
  const [userName, setUserName] = useState('');
  const dataSource = useDataSource();
  const { data, isLoading, error } = useQuery({
    queryKey: ['permissions', 'user', userId, dataSource] as const,
    enabled: !!userId,
    queryFn: () => fetchUserProjectPermissions(userId, { source: dataSource }),
  });

  const grouped = useMemo(() => {
    if (!data) return null;
    const byReason: Partial<Record<PermissionReason, typeof data.projects>> = {};
    for (const p of data.projects) {
      // Attribute the project to its *primary* reason for grouping.
      // Order matches the visual hierarchy on the page.
      const primary =
        p.reasons.includes('primary_team_lead') ? 'primary_team_lead'
        : p.reasons.includes('project_manager') ? 'project_manager'
        : p.reasons.includes('executive_sponsor') ? 'executive_sponsor'
        : p.reasons.includes('manager') ? 'manager'
        : p.reasons.includes('collaborator_full') ? 'collaborator_full'
        : p.reasons.includes('collaborator_tasks_and_notes') ? 'collaborator_tasks_and_notes'
        : p.reasons.includes('primary_team_member') ? 'primary_team_member'
        : p.reasons[0];
      const list = byReason[primary] ?? [];
      list.push(p);
      byReason[primary] = list;
    }
    return byReason;
  }, [data]);

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <header>
        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> User Permissions Viewer</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Search a user to see every project they can edit and why.</p>
      </header>
      <div className="max-w-md">
        <SearchableSelect
          value={userId}
          onChange={(v) => { setUserId(v); if (!v) setUserName(''); }}
          onSearch={async (q) => {
            const opts = await searchUsers(q);
            return opts;
          }}
          resolveLabel={async (id) => {
            const label = await resolveUserLabel(id);
            setUserName(label);
            return label;
          }}
          placeholder="Search by name…"
          minSearchLength={2}
        />
      </div>

      {!userId && (
        <p className="text-xs italic text-muted-foreground">Pick a user to see their project access.</p>
      )}
      {userId && isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Resolving…</div>
      )}
      {userId && error && <ErrorBanner error={error as Error} />}
      {userId && data && grouped && (
        <div className="space-y-3">
          {/* Categorized groups */}
          {(['primary_team_lead', 'project_manager', 'executive_sponsor', 'manager',
             'collaborator_full', 'collaborator_tasks_and_notes',
             'primary_team_member'] as PermissionReason[]).map((r) => {
            const list = grouped[r];
            if (!list || list.length === 0) return null;
            return (
              <div key={r}>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">{reasonLabel(r)} <span className="text-muted-foreground/60">({list.length})</span></p>
                <ul className="flex flex-wrap gap-1.5">
                  {list.map((p) => {
                    const pill = scopePill(p.effectiveScope);
                    return (
                      <li key={p.projectId} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-border bg-background">
                        <a href={`#/projects/${p.projectId}`} className="text-foreground hover:text-primary hover:underline">{p.projectName}</a>
                        <Badge className={`${pill.className} text-[10px] px-1.5 py-0`}>{pill.label}</Badge>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

          {data.projects.length === 0 && !data.isAdmin && (
            <p className="text-xs italic text-muted-foreground">
              {userName || 'This user'} has no edit access on any project.
              (They can still read the app but every edit surface is disabled.)
            </p>
          )}

          {/* Effective-scope summary */}
          {data.projects.length > 0 && (
            <details className="rounded-md border border-border bg-muted/20 p-3">
              <summary className="text-xs font-semibold uppercase tracking-widest text-muted-foreground cursor-pointer">Effective scope summary</summary>
              <table className="text-xs mt-2 w-full">
                <thead className="text-muted-foreground">
                  <tr><th className="text-left font-medium pb-1">Project</th><th className="text-left font-medium pb-1">Reason(s)</th><th className="text-left font-medium pb-1">Scope</th></tr>
                </thead>
                <tbody>
                  {data.projects.map((p) => {
                    const pill = scopePill(p.effectiveScope);
                    return (
                      <tr key={p.projectId} className="border-t border-border/60">
                        <td className="py-1 pr-2 text-foreground">{p.projectName}</td>
                        <td className="py-1 pr-2 text-muted-foreground">{p.reasons.map(reasonLabel).join(', ')}</td>
                        <td className="py-1"><Badge className={`${pill.className} text-[10px] px-1.5 py-0`}>{pill.label}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export function PermissionsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Permissions"
        subtitle="Monthly unique users, per-user project access, and (soon) individual Collaborate shares."
      />
      <MonthlyUniqueUsersPanel />
      <UserPermissionsViewer />
    </div>
  );
}
