import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Users, Shield, FileText } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { LoadingOverlay } from '../../components/common/LoadingOverlay';
import { Input } from '../../components/ui/input';
import { useAppSettings, useUpsertSetting } from '../../hooks/useAppSettings';
import { useProjectTemplates } from '../../hooks/useProjectTemplates';
import { useRequireAdminRole } from '../../hooks/useRequireAdminRole';
import { toast } from '../../hooks/useToast';
import * as dv from '../../lib/dataverseClient';
import { ENTITY_SETS, SETTING_TEAM_DEFAULT_TEMPLATE_PREFIX } from '../../lib/constants';
import { fetchPmoTeams, resolveSidebarTeamName } from '../../lib/pmoTeams';
import { usePmoTeamField } from '../../providers/ConfigurationProvider';

interface SystemTeam {
  teamid: string;
  name: string;
  teamtype: number;
  description?: string;
  _administratorid_value?: string;
  '_administratorid_value@OData.Community.Display.V1.FormattedValue'?: string;
  [key: string]: unknown;
}

interface TeamMember {
  systemuserid: string;
  fullname: string;
}

function useSystemTeams() {
  const pmoTeamField = usePmoTeamField();
  return useQuery({
    queryKey: ['systemTeams', pmoTeamField],
    queryFn: () =>
      fetchPmoTeams<SystemTeam>(pmoTeamField, ['teamid', 'name', 'teamtype', 'description', '_administratorid_value']),
  });
}

function useTeamMembers(teamId: string | null) {
  return useQuery({
    queryKey: ['teamMembers', teamId],
    queryFn: () =>
      dv.list<TeamMember>(ENTITY_SETS.systemUser, {
        $select: ['systemuserid', 'fullname'],
        $filter: `teammembership_association/any(t: t/teamid eq '${teamId}')`,
        $orderby: 'fullname asc',
      }),
    enabled: !!teamId,
    staleTime: 5 * 60 * 1000,
  });
}

function MemberChip({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0] ?? '')
    .join('')
    .toUpperCase();
  return (
    <div className="flex items-center gap-2 text-sm py-0.5">
      <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
        {initials}
      </div>
      <span className="text-foreground">{name}</span>
    </div>
  );
}

interface TeamRowProps {
  team: SystemTeam;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
  defaultTemplateId: string;
  defaultTemplateName: string | undefined;
  templateOptions: { id: string; name: string }[];
  onTemplateChange: (teamId: string, templateId: string) => void;
  templateSaving: boolean;
  canAssignTemplate: boolean;
}

function TeamRow({
  team, expanded, onToggle, onOpen,
  defaultTemplateId, defaultTemplateName, templateOptions, onTemplateChange, templateSaving,
  canAssignTemplate,
}: TeamRowProps) {
  const { data: members = [], isLoading: membersLoading } = useTeamMembers(
    expanded ? team.teamid : null,
  );
  const { data: appSettings } = useAppSettings();
  const displayName = resolveSidebarTeamName(team.teamid, team.name, appSettings);

  const adminId = team._administratorid_value;
  const adminNameFromAnnotation =
    team['_administratorid_value@OData.Community.Display.V1.FormattedValue'];
  const adminFromMembers = adminId ? members.find((m) => m.systemuserid === adminId) : undefined;
  const adminName = adminNameFromAnnotation ?? adminFromMembers?.fullname;

  const regularMembers = members.filter((m) => m.systemuserid !== adminId);

  return (
    <div>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary shrink-0">
          <Users className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-foreground">{displayName}</div>
          {team.description && (
            <div className="text-xs text-muted-foreground truncate">{team.description}</div>
          )}
        </div>
        {defaultTemplateName && !expanded && (
          <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
            <FileText className="h-3 w-3" />
            {defaultTemplateName}
          </span>
        )}
        {expanded && !membersLoading && (
          <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
            {members.length} member{members.length !== 1 ? 's' : ''}
          </span>
        )}
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onOpen(); } }}
          className="text-xs text-primary hover:underline shrink-0 mr-2 cursor-pointer"
          title="Open team page"
        >
          Open
        </span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-6 pb-5 bg-muted/30 border-t">
          {membersLoading ? (
            <div className="py-4 text-sm text-muted-foreground">Loading members...</div>
          ) : (
            <div className="pt-4 space-y-4">
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Shield className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Owner
                    </span>
                  </div>
                  {adminName ? (
                    <MemberChip name={adminName} />
                  ) : (
                    <span className="text-sm text-muted-foreground">{'—'}</span>
                  )}
                </div>

                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Members ({regularMembers.length})
                  </div>
                  {regularMembers.length === 0 ? (
                    <span className="text-sm text-muted-foreground">No additional members.</span>
                  ) : (
                    <div className="space-y-0.5 max-h-48 overflow-y-auto">
                      {regularMembers.map((m) => (
                        <MemberChip key={m.systemuserid} name={m.fullname} />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {canAssignTemplate && (
                <div className="border-t border-border pt-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <FileText className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Default Project Template
                    </span>
                  </div>
                  <select
                    value={defaultTemplateId}
                    onChange={(e) => onTemplateChange(team.teamid, e.target.value)}
                    disabled={templateSaving}
                    className="w-full max-w-xs h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                  >
                    <option value="">{'—'} no default {'—'}</option>
                    {templateOptions.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  {defaultTemplateName && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Projects assigned to this team will use &quot;{defaultTemplateName}&quot; unless a different template is selected.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TeamsPage() {
  const navigate = useNavigate();
  const { data: teams = [], isLoading, error } = useSystemTeams();
  const { data: settings = [] } = useAppSettings();
  const { data: templates = [] } = useProjectTemplates();
  const upsert = useUpsertSetting();
  const canAssignTemplate = useRequireAdminRole('pmo_admin');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const settingMap = Object.fromEntries(settings.map((s) => [s.pmo_key, s]));

  const templateOptions = templates.map((t) => ({
    id: t.pmo_projecttemplateid,
    name: t.pmo_name,
  }));

  const getTeamDefaultTemplateId = useCallback(
    (teamId: string): string => {
      const key = `${SETTING_TEAM_DEFAULT_TEMPLATE_PREFIX}${teamId}`;
      return settingMap[key]?.pmo_value ?? '';
    },
    [settingMap],
  );

  const getTeamDefaultTemplateName = useCallback(
    (teamId: string): string | undefined => {
      const templateId = getTeamDefaultTemplateId(teamId);
      if (!templateId) return undefined;
      return templates.find((t) => t.pmo_projecttemplateid === templateId)?.pmo_name;
    },
    [getTeamDefaultTemplateId, templates],
  );

  function handleTemplateChange(teamId: string, templateId: string) {
    const key = `${SETTING_TEAM_DEFAULT_TEMPLATE_PREFIX}${teamId}`;
    const templateName = templates.find((t) => t.pmo_projecttemplateid === templateId)?.pmo_name;
    upsert.mutate({ key, value: templateId }, {
      onSuccess: () => toast.success(templateId ? `Default template set to "${templateName}"` : 'Default template cleared'),
    });
  }

  const filtered = teams.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      (t.description ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  function handleToggle(teamId: string) {
    setExpandedId((prev) => (prev === teamId ? null : teamId));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teams"
        subtitle={`${teams.length} PMO team${teams.length !== 1 ? 's' : ''} available for project assignment`}
      />
      <ErrorBanner error={error as Error | null} />

      <div className="flex items-center gap-4">
        <Input
          placeholder="Search teams..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        {search && filtered.length !== teams.length && (
          <span className="text-sm text-muted-foreground">
            {filtered.length} of {teams.length} team{teams.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {isLoading ? (
        <LoadingOverlay isLoading />
      ) : (
        <div className="rounded-xl border border-border divide-y overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-8 text-center">
              <Users className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">No teams found</p>
              <p className="text-xs text-muted-foreground mt-1">
                {search ? 'Try adjusting your search.' : 'No PMO teams have been configured.'}
              </p>
            </div>
          ) : (
            filtered.map((team) => (
              <TeamRow
                key={team.teamid}
                team={team}
                expanded={expandedId === team.teamid}
                onToggle={() => handleToggle(team.teamid)}
                onOpen={() => navigate(`/teams/${team.teamid}`)}
                defaultTemplateId={getTeamDefaultTemplateId(team.teamid)}
                defaultTemplateName={getTeamDefaultTemplateName(team.teamid)}
                templateOptions={templateOptions}
                onTemplateChange={handleTemplateChange}
                templateSaving={upsert.isPending}
                canAssignTemplate={canAssignTemplate}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
