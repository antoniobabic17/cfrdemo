import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ChevronRight, ChevronLeft, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SearchableSelect, type SelectOption } from '../../components/common/SearchableSelect';
import { useCreateProject } from '../../hooks/useProjects';
import { useChangeAudit } from '../../hooks/useChangeAudit';
import { toast } from '../../hooks/useToast';
import { toFriendlyError } from '../../lib/utils';
import { useProjectTemplates } from '../../hooks/useProjectTemplates';
import { useAppSettings } from '../../hooks/useAppSettings';
import { createProjectTeam } from '../../api/projectTeams.api';
import { getCachedDataSource, usesCustomTables } from '../../lib/taskSource';
import { createProjectBucket } from '../../api/projectBuckets.api';
import { createCustomBucket } from '../../api/customBuckets.api';
import { listSystems } from '../../api/systems.api';
import { useTaskSource } from '../../lib/taskSource';
import { CFR_CATEGORY_LABELS } from '../../lib/projectTemplates';
import { resolveTemplate } from '../../lib/templateResolution';
import * as dv from '../../lib/dataverseClient';
import { emitRoleAssigned } from '../../lib/notify';
import {
  ENTITY_SETS, TEAM_ROLE,
  COMPLEXITY, STRATEGIC_PRIORITY, OVERALL_HEALTH,
  SETTING_USER_SCOPE_GROUP,
} from '../../lib/constants';
import { fetchPmoTeams, resolveSidebarTeamName } from '../../lib/pmoTeams';
import { usePmoTeamField } from '../../providers/ConfigurationProvider';
import { useQuery } from '@tanstack/react-query';
import { toDataverseDateOnly, todayLocalYmd } from '../../lib/dateOnly';

interface ProjectOnboardingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: {
    name?: string;
    description?: string;
    primaryTeamId?: string;
    lineOfBusiness?: number;
    cfrCategory?: number;
    affectedSystemId?: string;
  };
  lockedFields?: string[];
  onCreated?: (projectId: string) => void;
}

const STEPS = ['Basics', 'Ownership', 'Template', 'Team', 'Classification', 'Review'] as const;

interface PmoTeam { teamid: string; name: string; [key: string]: unknown; }

function usePmoTeams() {
  const pmoTeamField = usePmoTeamField();
  return useQuery<SelectOption[]>({
    queryKey: ['pmoTeamsForWizard', pmoTeamField],
    queryFn: async () => {
      const teams = await fetchPmoTeams<PmoTeam>(pmoTeamField, ['teamid', 'name']);
      return teams.map((t) => ({ value: t.teamid, label: t.name }));
    },
    staleTime: Infinity,
  });
}

const USER_BASE_FILTER = "isdisabled eq false and accessmode ne 4 and accessmode ne 5 and applicationid eq null";

interface UserRow { systemuserid: string; fullname: string; lastname: string; firstname: string; }
function fmtUserName(u: UserRow): string {
  if (u.lastname && u.firstname) return `${u.lastname}, ${u.firstname}`;
  return u.fullname;
}

export function ProjectOnboardingWizard({ open, onOpenChange, prefill, lockedFields = [], onCreated }: ProjectOnboardingWizardProps) {
  const isLocked = (field: string) => lockedFields.includes(field);
  const navigate = useNavigate();
  const createProject = useCreateProject();
  const auditChange = useChangeAudit();
  const { data: templates = [] } = useProjectTemplates();
  const { data: settings = [] } = useAppSettings();
  const { data: pmoTeamsRaw = [] } = usePmoTeams();
  // Apply the admin team-name override so renamed teams show their display
  // name in the Primary + Contributing pickers (matches sidebar/filters/list).
  const pmoTeams = useMemo(
    () => pmoTeamsRaw.map((t) => ({ ...t, label: resolveSidebarTeamName(t.value, t.label, settings) })),
    [pmoTeamsRaw, settings],
  );
  const { data: systems = [] } = useQuery({
    queryKey: ['systems'],
    queryFn: listSystems,
    staleTime: Infinity,
  });

  const settingMap = useMemo(() => Object.fromEntries(settings.map((s) => [s.pmo_key, s])), [settings]);
  const wizardTaskSource = useTaskSource();

  const [step, setStep] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Basics
  const [name, setName] = useState(prefill?.name ?? '');
  const [description, setDescription] = useState(prefill?.description ?? '');
  const [scheduledStart, setScheduledStart] = useState('');
  const [cfrCategory, setCfrCategory] = useState<string>(
    prefill?.cfrCategory != null ? String(prefill.cfrCategory) : '',
  );
  const [affectedSystemId, setAffectedSystemId] = useState(prefill?.affectedSystemId ?? '');

  // Step 2: Ownership
  const [pmId, setPmId] = useState('');
  const [sponsorId, setSponsorId] = useState('');
  const [primaryTeamId, setPrimaryTeamId] = useState(prefill?.primaryTeamId ?? '');

  // Step 3: Template
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  // Step 4: Team
  // Manager field intentionally removed from the project UI. The proj_Manager
  // column is still on the msdyn_project entity (programs use it as
  // "Program Manager"), but on projects it duplicates Project Manager /
  // Executive Sponsor with no clear semantic. Hidden here, not deleted.
  const [contributingTeamIds, setContributingTeamIds] = useState<string[]>([]);
  const [addingTeamId, setAddingTeamId] = useState('');

  // Step 5: Classification
  const [complexity, setComplexity] = useState<string>('');
  const [strategicPriority, setStrategicPriority] = useState<string>('');
  const [overallHealth, setOverallHealth] = useState<string>(String(OVERALL_HEALTH.OnTrack));
  const [budget, setBudget] = useState('');

  // Resolve scope team for user search
  const scopeGroupId = settingMap[SETTING_USER_SCOPE_GROUP]?.pmo_value;
  const { data: scopeTeamId } = useQuery({
    queryKey: ['scopeTeamResolve', scopeGroupId],
    queryFn: async () => {
      if (!scopeGroupId) return null;
      const teams = await dv.list<{ teamid: string }>(ENTITY_SETS.team, {
        $select: ['teamid'],
        $filter: `azureactivedirectoryobjectid eq '${scopeGroupId}'`,
        $top: 1,
      });
      return teams[0]?.teamid ?? null;
    },
    enabled: !!scopeGroupId,
    staleTime: Infinity,
  });

  const searchUsers = useCallback(async (query: string): Promise<SelectOption[]> => {
    const nameFilter = `(contains(lastname,'${query}') or contains(firstname,'${query}') or contains(fullname,'${query}'))`;
    const scopeFilter = scopeTeamId
      ? `teammembership_association/any(t: t/teamid eq '${scopeTeamId}') and ` : '';
    const users = await dv.list<UserRow>(ENTITY_SETS.systemUser, {
      $select: ['systemuserid', 'fullname', 'lastname', 'firstname'],
      $filter: `${scopeFilter}${USER_BASE_FILTER} and ${nameFilter}`,
      $orderby: 'lastname asc,firstname asc',
      $top: 50,
    });
    return users.map((u) => ({ value: u.systemuserid, label: fmtUserName(u) }));
  }, [scopeTeamId]);

  const resolveUserLabel = useCallback(async (id: string): Promise<string> => {
    const u = await dv.get<UserRow>(ENTITY_SETS.systemUser, id, ['systemuserid', 'fullname', 'lastname', 'firstname']);
    return fmtUserName(u);
  }, []);

  // Resolve template using precedence hierarchy (shared with auto-conversion in lib/templateResolution.ts)
  const { template: resolvedTemplate, source: templateSource } = useMemo(
    () => resolveTemplate({
      settingMap,
      templates,
      selectedTemplateId,
      primaryTeamId,
      cfrCategory: cfrCategory ? Number(cfrCategory) : undefined,
    }),
    [settingMap, templates, selectedTemplateId, primaryTeamId, cfrCategory],
  );

  // Available teams for contributing (exclude primary and already-added)
  const availableContributingTeams = pmoTeams.filter(
    (t) => t.value !== primaryTeamId && !contributingTeamIds.includes(t.value),
  );

  function addContributingTeam() {
    if (addingTeamId && !contributingTeamIds.includes(addingTeamId)) {
      setContributingTeamIds([...contributingTeamIds, addingTeamId]);
      setAddingTeamId('');
    }
  }

  function removeContributingTeam(id: string) {
    setContributingTeamIds(contributingTeamIds.filter((t) => t !== id));
  }

  const canProceed = () => {
    // Start Date is required by Project Operations scheduling — without it, PSS rejects
    // task creation with "scheduledStart readonly" because it has no anchor to compute from.
    // Primary Team is required so the project is editable under the team-based permission
    // model (May 2026 overhaul) — without it, only admins could edit the project after create.
    if (step === 0) return !!name.trim() && !!scheduledStart && !!primaryTeamId;
    return true;
  };

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const createPayload: Record<string, unknown> = {
        msdyn_subject: name.trim(),
      };
      if (description.trim()) createPayload.msdyn_description = description.trim();
      if (scheduledStart) createPayload.msdyn_scheduledstart = toDataverseDateOnly(scheduledStart);
      if (cfrCategory) createPayload.pmo_cfrcategory = Number(cfrCategory);
      if (complexity) createPayload.pmo_complexity = Number(complexity);
      if (strategicPriority) createPayload.pmo_strategicpriority = Number(strategicPriority);
      if (overallHealth) createPayload.proj_overallhealth = Number(overallHealth);
      if (budget) createPayload.proj_budget = Number(budget);
      if (pmId) createPayload['msdyn_projectmanager@odata.bind'] = `/systemusers(${pmId})`;
      if (sponsorId) createPayload['proj_ExecutiveSponsor@odata.bind'] = `/systemusers(${sponsorId})`;
      if (primaryTeamId) createPayload['pmo_PrimaryTeam@odata.bind'] = `/teams(${primaryTeamId})`;
      if (affectedSystemId) createPayload['pmo_AffectedSystem@odata.bind'] = `/cr87a_systems(${affectedSystemId})`;

      // The project create is the ONLY step whose failure means "project not
      // created" — everything after it (default bucket, team roster rows,
      // template task apply) is downstream setup. If any of those fail after
      // the project row exists, the user needs to see a very different message:
      // "Project was created, but final setup partially failed" — not the
      // misleading "Failed to create project" toast that treats the whole flow
      // as a rollback.
      let project;
      try {
        project = await createProject.mutateAsync(createPayload);
      } catch (createErr) {
        // Project itself was NOT created — this IS a "failed to create" case.
        const msg = toFriendlyError(createErr, 'Failed to create project');
        setError(msg);
        toast.error(msg);
        return;
      }
      const projectId = project.msdyn_projectid;
      // Notify newly-assigned PM / Executive Sponsor (skip self-assign).
      {
        const actor = dv.getCurrentUserId();
        if (pmId) void emitRoleAssigned({ assigneeUserId: pmId, actorUserId: actor, role: 'Project Manager', entityKind: 'project', entityId: projectId, entityName: name.trim() });
        if (sponsorId) void emitRoleAssigned({ assigneeUserId: sponsorId, actorUserId: actor, role: 'Executive Sponsor', entityKind: 'project', entityId: projectId, entityName: name.trim() });
      }
      auditChange({
        entityType: 'project',
        entityId: projectId,
        entityName: name.trim(),
        action: 'create',
        parentProjectId: projectId,
        parentProjectName: name.trim(),
      });

      // From here on, the project row EXISTS. Track any downstream setup
      // failures individually and, at the end, decide whether to show a
      // "created, but ..." warning toast instead of a red-error one.
      const setupFailures: string[] = [];

      // Default "General" bucket. Two-step attempt: PSS first (preserves
      // schedule integration), direct Dataverse write as fallback if PSS
      // silently drops the request. See intakeAutoConvert.ts for the same
      // pattern and the 2026-07-14 root-cause note.
      if (usesCustomTables(wizardTaskSource)) {
        // Custom source: direct OData create on pmo_bucket -- instant, no PSS lag.
        try {
          await createCustomBucket(projectId, 'General', 1);
        } catch (err) {
          console.warn('Default General bucket (custom) failed (non-fatal):', err);
          setupFailures.push('default bucket');
        }
      } else {
        try {
          await createProjectBucket(projectId, 'General', 1);
        } catch (err) {
          console.warn('Default General bucket via PSS failed; falling back to direct Dataverse write:', err);
          try {
            await dv.create(ENTITY_SETS.projectBucket, {
              msdyn_name: 'General',
              msdyn_displayorder: 1,
              'msdyn_project@odata.bind': `/msdyn_projects(${projectId})`,
            });
          } catch (fallbackErr) {
            console.warn('Default General bucket direct-write also failed (non-fatal):', fallbackErr);
            setupFailures.push('default bucket');
          }
        }
      }

      if (primaryTeamId) {
        try {
          await createProjectTeam({
            'pmo_Project@odata.bind': `/msdyn_projects(${projectId})`,
            'pmo_Team@odata.bind': `/teams(${primaryTeamId})`,
            pmo_role: TEAM_ROLE.Primary,
            pmo_joineddate: toDataverseDateOnly(todayLocalYmd()),
          }, getCachedDataSource());
        } catch (err) {
          console.warn('Primary team roster row creation failed:', err);
          setupFailures.push('primary team roster');
        }
      }

      for (const ctId of contributingTeamIds) {
        try {
          await createProjectTeam({
            'pmo_Project@odata.bind': `/msdyn_projects(${projectId})`,
            'pmo_Team@odata.bind': `/teams(${ctId})`,
            pmo_role: TEAM_ROLE.Contributing,
            pmo_joineddate: new Date().toISOString().split('T')[0],
          }, getCachedDataSource());
        } catch (err) {
          console.warn('Contributing team roster row creation failed:', err);
          setupFailures.push('contributing team roster');
        }
      }

      // NOTE (2026-07-31): a brand-new project must start with NO tasks (operator
      // directive). WBS-template task seeding (explicit pick / team default /
      // system default / CFR-category fallback) is intentionally removed. The
      // General bucket above is still created so the board has a place to add
      // tasks. resolvedTasks remains only for the wizard preview; it drives no writes.

      if (setupFailures.length === 0) {
        toast.success(`Project "${name.trim()}" created successfully`);
      } else {
        // Project row is there — the user should navigate to it and the admin
        // can finish the setup. Don't red-toast this; that reads as "your save
        // was rejected" when the save actually landed.
        toast.warning(
          `Project "${name.trim()}" was created, but final setup didn't complete: ${setupFailures.join(', ')}. An admin may need to finish setup.`,
        );
      }
      onOpenChange(false);
      if (onCreated) onCreated(projectId);
      else navigate(`/projects/${projectId}`);
    } catch (e) {
      // Any exception NOT handled above (shouldn't happen after the split,
      // but keep the safety net for unforeseen throws).
      const msg = toFriendlyError(e, 'Failed to create project');
      setError(msg);
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  const selectCls = "w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 mb-4">
          {STEPS.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => { if (i < step) setStep(i); }}
              className={`text-xs px-2 py-1 rounded-full transition-colors ${
                i === step ? 'bg-primary text-primary-foreground font-medium' :
                i < step ? 'bg-primary/10 text-primary cursor-pointer' :
                'bg-muted text-muted-foreground'
              }`}
            >
              {i < step ? <Check className="h-3 w-3 inline mr-0.5" /> : null}
              {s}
            </button>
          ))}
        </div>

        {/* Step 0: Basics */}
        {step === 0 && (
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Project Name *{isLocked('msdyn_subject') && <span className="text-xs text-muted-foreground ml-1">🔒 from intake</span>}</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter project name" disabled={isLocked('msdyn_subject')} />
            </div>
            <div>
              <label className="text-sm font-medium">Description{isLocked('msdyn_description') && <span className="text-xs text-muted-foreground ml-1">🔒 from intake</span>}</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Brief project description"
                disabled={isLocked('msdyn_description')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Scheduled Start <span className="text-destructive">*</span></label>
                <Input type="date" value={scheduledStart} onChange={(e) => setScheduledStart(e.target.value)} required />
                <p className="text-[11px] text-muted-foreground mt-1">Required for task scheduling.</p>
              </div>
              <div>
                <label className="text-sm font-medium">CFR Category</label>
                <select value={cfrCategory} onChange={(e) => setCfrCategory(e.target.value)} className={selectCls}>
                  <option value="">Select category</option>
                  {Object.entries(CFR_CATEGORY_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Ownership */}
        {step === 1 && (
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Project Manager</label>
              <SearchableSelect value={pmId} onChange={setPmId} onSearch={searchUsers} resolveLabel={resolveUserLabel} placeholder="Search for PM..." minSearchLength={2} />
            </div>
            <div>
              <label className="text-sm font-medium">Executive Sponsor</label>
              <SearchableSelect value={sponsorId} onChange={setSponsorId} onSearch={searchUsers} resolveLabel={resolveUserLabel} placeholder="Search for sponsor..." minSearchLength={2} />
            </div>
            <div>
              <label className="text-sm font-medium">Primary Team <span className="text-rose-500">*</span></label>
              <SearchableSelect value={primaryTeamId} onChange={setPrimaryTeamId} options={pmoTeams} placeholder="Select primary team..." />
              <p className="text-xs text-muted-foreground mt-1">Required. Determines who can edit this project after creation.</p>
            </div>
          </div>
        )}

        {/* Step 2: Template */}
        {step === 2 && (
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Project Template</label>
              <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)} className={selectCls}>
                <option value="">Use default</option>
                {templates.map((t) => (
                  <option key={t.pmo_projecttemplateid} value={t.pmo_projecttemplateid}>{t.pmo_name}</option>
                ))}
              </select>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">Resolved template: <span className="text-foreground">{resolvedTemplate?.pmo_name ?? 'Category fallback'}</span></p>
              <p className="text-xs text-muted-foreground">Source: {templateSource}</p>
              <p className="text-xs text-muted-foreground mt-2">New projects start empty — add tasks from the Plan tab after creation.</p>
            </div>
          </div>
        )}

        {/* Step 3: Team & Collaboration */}
        {step === 3 && (
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Contributing Teams</label>
              {contributingTeamIds.length > 0 && (
                <div className="space-y-1 mb-2">
                  {contributingTeamIds.map((ctId) => {
                    const t = pmoTeams.find((pt) => pt.value === ctId);
                    return (
                      <div key={ctId} className="flex items-center justify-between px-3 py-1.5 rounded-md bg-muted/50 text-sm">
                        <span>{t?.label ?? ctId}</span>
                        <button type="button" onClick={() => removeContributingTeam(ctId)} className="text-xs text-destructive hover:underline">Remove</button>
                      </div>
                    );
                  })}
                </div>
              )}
              {availableContributingTeams.length > 0 && (
                <div className="flex items-center gap-2">
                  <select value={addingTeamId} onChange={(e) => setAddingTeamId(e.target.value)} className={selectCls}>
                    <option value="">Select team to add...</option>
                    {availableContributingTeams.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <Button size="sm" variant="outline" onClick={addContributingTeam} disabled={!addingTeamId}>Add</Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 4: Classification & Governance */}
        {step === 4 && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Complexity</label>
                <select value={complexity} onChange={(e) => setComplexity(e.target.value)} className={selectCls}>
                  <option value="">Select...</option>
                  <option value={String(COMPLEXITY.Low)}>Low</option>
                  <option value={String(COMPLEXITY.Medium)}>Medium</option>
                  <option value={String(COMPLEXITY.High)}>High</option>
                  <option value={String(COMPLEXITY.Critical)}>Critical</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Strategic Priority</label>
                <select value={strategicPriority} onChange={(e) => setStrategicPriority(e.target.value)} className={selectCls}>
                  <option value="">Select...</option>
                  <option value={String(STRATEGIC_PRIORITY.MustHave)}>Must Have</option>
                  <option value={String(STRATEGIC_PRIORITY.ShouldHave)}>Should Have</option>
                  <option value={String(STRATEGIC_PRIORITY.NiceToHave)}>Nice to Have</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Overall Health</label>
                <select value={overallHealth} onChange={(e) => setOverallHealth(e.target.value)} className={selectCls}>
                  <option value={String(OVERALL_HEALTH.OnTrack)}>On Track</option>
                  <option value={String(OVERALL_HEALTH.AtRisk)}>At Risk</option>
                  <option value={String(OVERALL_HEALTH.OffTrack)}>Off Track</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Budget</label>
                <Input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Affected System</label>
              <select value={affectedSystemId} onChange={(e) => setAffectedSystemId(e.target.value)} className={selectCls}>
                <option value="">None / Not applicable</option>
                {systems.map((s) => (
                  <option key={s.cr87a_systemid} value={s.cr87a_systemid}>{s.cr87a_systemname}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Step 5: Review */}
        {step === 5 && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-card p-4 space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                <div><span className="text-muted-foreground">Name:</span> <span className="font-medium">{name}</span></div>
                {cfrCategory && <div><span className="text-muted-foreground">Category:</span> {CFR_CATEGORY_LABELS[Number(cfrCategory)]}</div>}
                {scheduledStart && <div><span className="text-muted-foreground">Start:</span> {scheduledStart}</div>}
                {primaryTeamId && <div><span className="text-muted-foreground">Primary Team:</span> {pmoTeams.find(t => t.value === primaryTeamId)?.label}</div>}
                {affectedSystemId && <div><span className="text-muted-foreground">Affected System:</span> {systems.find(s => s.cr87a_systemid === affectedSystemId)?.cr87a_systemname}</div>}
                {contributingTeamIds.length > 0 && <div><span className="text-muted-foreground">Contributing:</span> {contributingTeamIds.length} team(s)</div>}
                <div><span className="text-muted-foreground">Template:</span> {resolvedTemplate?.pmo_name ?? 'Category fallback'} ({templateSource})</div>
                <div><span className="text-muted-foreground">Tasks:</span> none — new projects start empty</div>
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between pt-4 border-t">
          <Button variant="ghost" size="sm" onClick={() => step > 0 ? setStep(step - 1) : onOpenChange(false)}>
            <ChevronLeft className="h-3.5 w-3.5 mr-1" />
            {step > 0 ? 'Back' : 'Cancel'}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button size="sm" onClick={() => setStep(step + 1)} disabled={!canProceed()}>
              Next
              <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          ) : (
            <Button size="sm" onClick={handleCreate} disabled={creating || !name.trim()}>
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Check className="h-3.5 w-3.5 mr-1.5" />}
              Create Project
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
