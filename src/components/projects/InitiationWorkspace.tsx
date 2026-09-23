import { useMemo, useState } from 'react';
import { Check, Circle, AlertTriangle, ChevronRight, Pencil, FileText, Users, Shield, Layers, Target, Link } from 'lucide-react';
import { Button } from '../ui/button';
import { useProject } from '../../hooks/useProjects';
import { useArtifactReadiness, useUpdateProjectArtifactStatus, useCreateProjectArtifactStatus } from '../../hooks/useRequiredArtifacts';
import { useProjectGates } from '../../hooks/useProjectGates';
import { useProjectTeams } from '../../hooks/useProjectTeams';
import { useProjectTasks } from '../../hooks/useProjectTasks';
import { useProjectSourceRequest } from '../../hooks/useProjectSourceRequest';
import { GATE_TYPE, GATE_STATUS, ARTIFACT_STATUS, TEAM_ROLE } from '../../lib/constants';
import type { ApprovalAction } from '../../lib/intakeValidation';
import { toast } from '../../hooks/useToast';
import { cn } from '../../lib/utils';

import { READ_ONLY_TOOLTIP } from '../../hooks/useProjectPermissions';
import { toDataverseDateOnly, todayLocalYmd } from '../../lib/dateOnly';

interface InitiationWorkspaceProps {
  projectId: string;
  onEditProject?: () => void;
  canEdit?: boolean;
}

type Dimension = 'metadata' | 'ownership' | 'teams' | 'governance' | 'artifacts' | 'template' | 'execution' | 'traceability';

interface DimensionState {
  key: Dimension;
  label: string;
  icon: React.ElementType;
  status: 'complete' | 'partial' | 'missing';
  detail: string;
}

export function InitiationWorkspace({ projectId, onEditProject, canEdit = true }: InitiationWorkspaceProps) {
  const { data: project } = useProject(projectId);
  const { definitions, statuses } = useArtifactReadiness(projectId);
  const { data: gates = [] } = useProjectGates(projectId);
  const { data: projectTeams = [] } = useProjectTeams(projectId);
  const { data: tasks = [] } = useProjectTasks(projectId);
  const { data: sourceRequest } = useProjectSourceRequest(projectId);
  const updateArtifactStatus = useUpdateProjectArtifactStatus(projectId);
  const createArtifactStatus = useCreateProjectArtifactStatus(projectId);

  const [expandedDim, setExpandedDim] = useState<Dimension | null>(null);

  const primaryTeam = projectTeams.find((t) => t.pmo_role === TEAM_ROLE.Primary);
  const contributingTeams = projectTeams.filter((t) => t.pmo_role === TEAM_ROLE.Contributing);
  const initGate = gates.find((g) => g.pmo_gatetype === GATE_TYPE.Initiation);

  const categoryArtifacts = useMemo(() => {
    const projectCategory = project?.pmo_cfrcategory;
    return definitions.filter((d) =>
      d.pmo_isrequired && (d.pmo_cfrcategory == null || d.pmo_cfrcategory === projectCategory),
    );
  }, [definitions, project?.pmo_cfrcategory]);

  const categoryDone = useMemo(() => {
    return statuses.filter((s) =>
      (s.pmo_status === ARTIFACT_STATUS.Complete || s.pmo_status === ARTIFACT_STATUS.Waived) &&
      categoryArtifacts.some((d) => d.pmo_requiredartifactid === s['_pmo_requiredartifact_value']),
    ).length;
  }, [statuses, categoryArtifacts]);

  const dimensions: DimensionState[] = useMemo(() => {
    const p = project;
    const hasName = !!p?.msdyn_subject;
    const hasCategory = p?.pmo_cfrcategory != null;
    const hasStart = !!p?.msdyn_scheduledstart;
    const metadataComplete = hasName && hasCategory && hasStart;

    const hasPm = !!p?.['_msdyn_projectmanager_value'];
    const hasSponsor = !!p?.['_proj_executivesponsor_value'];
    const ownershipComplete = hasPm && hasSponsor;

    const hasTeam = !!primaryTeam;
    const teamComplete = hasTeam;

    const healthSet = p?.proj_overallhealth != null;
    const gateReady = !initGate || initGate.pmo_status === GATE_STATUS.Passed || initGate.pmo_status === GATE_STATUS.Waived;
    const govComplete = healthSet && gateReady;

    const artTotal = categoryArtifacts.length;
    const artComplete = artTotal > 0 ? categoryDone >= artTotal : true;

    const hasTasks = tasks.length > 0;

    return [
      { key: 'metadata', label: 'Metadata', icon: FileText, status: metadataComplete ? 'complete' : hasName ? 'partial' : 'missing', detail: metadataComplete ? 'All required fields set' : `Missing: ${[!hasName && 'name', !hasCategory && 'category', !hasStart && 'start date'].filter(Boolean).join(', ')}` },
      { key: 'ownership', label: 'Ownership', icon: Shield, status: ownershipComplete ? 'complete' : hasPm || hasSponsor ? 'partial' : 'missing', detail: ownershipComplete ? 'PM and Sponsor assigned' : `Missing: ${[!hasPm && 'PM', !hasSponsor && 'Sponsor'].filter(Boolean).join(', ')}` },
      { key: 'teams', label: 'Teams', icon: Users, status: teamComplete ? 'complete' : 'missing', detail: teamComplete ? `Primary: ${primaryTeam?.['_pmo_team_value@OData.Community.Display.V1.FormattedValue'] ?? 'Set'}${contributingTeams.length > 0 ? ` + ${contributingTeams.length} contributing` : ''}` : 'No primary team assigned' },
      { key: 'governance', label: 'Governance', icon: Shield, status: govComplete ? 'complete' : healthSet || initGate ? 'partial' : 'missing', detail: govComplete ? 'Health set, initiation gate passed' : `${!healthSet ? 'Health indicators not set' : ''}${initGate && initGate.pmo_status !== GATE_STATUS.Passed ? ' Initiation gate pending' : ''}` },
      { key: 'artifacts', label: 'Artifacts', icon: Layers, status: artComplete ? 'complete' : categoryDone > 0 ? 'partial' : artTotal === 0 ? 'complete' : 'missing', detail: artTotal > 0 ? `${categoryDone}/${artTotal} complete` : 'No required artifacts for this category' },
      { key: 'template', label: 'Template', icon: Target, status: hasTasks ? 'complete' : 'missing', detail: hasTasks ? `${tasks.length} tasks created` : 'No execution structure' },
      { key: 'execution', label: 'Execution', icon: ChevronRight, status: hasTasks && teamComplete ? 'complete' : hasTasks || teamComplete ? 'partial' : 'missing', detail: hasTasks && teamComplete ? 'Tasks and teams initialized' : 'Execution structure incomplete' },
      { key: 'traceability', label: 'Traceability', icon: Link, status: sourceRequest ? 'complete' : 'missing', detail: sourceRequest ? `From ${sourceRequest.pmo_autonumber ?? sourceRequest.pmo_name}` : 'Not tracked — project created outside governed intake' },
    ] as DimensionState[];
  }, [project, primaryTeam, contributingTeams, initGate, categoryArtifacts, categoryDone, tasks, sourceRequest]);

  const completeDims = dimensions.filter((d) => d.status === 'complete').length;
  const readinessPct = Math.round((completeDims / dimensions.length) * 100);

  const statusIcon = (status: string) =>
    status === 'complete' ? <Check className="h-4 w-4 text-emerald-500" /> :
    status === 'partial' ? <AlertTriangle className="h-4 w-4 text-amber-500" /> :
    <Circle className="h-4 w-4 text-rose-400" />;

  const statusCls = (status: string) =>
    status === 'complete' ? 'border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20' :
    status === 'partial' ? 'border-amber-200 bg-amber-50/50 dark:bg-amber-950/20' :
    'border-rose-200 bg-rose-50/50 dark:bg-rose-950/20';

  function handleArtifactAction(artifactId: string, action: 'complete' | 'inprogress' | 'waive') {
    const existing = statuses.find((s) => s['_pmo_requiredartifact_value'] === artifactId);
    const newStatus = action === 'complete' ? ARTIFACT_STATUS.Complete : action === 'waive' ? ARTIFACT_STATUS.Waived : ARTIFACT_STATUS.InProgress;
    if (existing) {
      updateArtifactStatus.mutate({ id: existing.pmo_projectartifactstatusid, payload: {
        pmo_status: newStatus,
        pmo_completeddate: action === 'complete' ? toDataverseDateOnly(todayLocalYmd()) : undefined,
      } }, { onSuccess: () => toast.success('Artifact status updated') });
    } else {
      createArtifactStatus.mutate({
        pmo_status: newStatus,
        pmo_completeddate: action === 'complete' ? new Date().toISOString().split('T')[0] : undefined,
        'pmo_Project@odata.bind': `/msdyn_projects(${projectId})`,
        'pmo_RequiredArtifact@odata.bind': `/pmo_requiredartifacts(${artifactId})`,
      } as Parameters<typeof createArtifactStatus.mutate>[0], { onSuccess: () => toast.success('Artifact status updated') });
    }
  }

  return (
    <div className="space-y-4">
      {/* Readiness Dashboard */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-foreground">Initiation Readiness</h4>
          <span className={cn('text-sm font-bold', readinessPct === 100 ? 'text-emerald-600' : readinessPct >= 50 ? 'text-amber-600' : 'text-rose-600')}>
            {readinessPct}%
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-muted overflow-hidden mb-4">
          <div className={cn('h-full rounded-full transition-all', readinessPct === 100 ? 'bg-emerald-500' : readinessPct >= 50 ? 'bg-amber-500' : 'bg-rose-400')} style={{ width: `${readinessPct}%` }} />
        </div>
        <div className="flex flex-wrap gap-2">
          {dimensions.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => setExpandedDim(expandedDim === d.key ? null : d.key)}
              className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                d.status === 'complete' ? 'border-emerald-300 bg-emerald-100/60 text-emerald-700' :
                d.status === 'partial' ? 'border-amber-300 bg-amber-100/60 text-amber-700' :
                'border-rose-300 bg-rose-100/60 text-rose-700',
                expandedDim === d.key && 'ring-2 ring-primary/30',
              )}
            >
              {statusIcon(d.status)}
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* Dimension Cards */}
      {dimensions.map((d) => (
        <div
          key={d.key}
          className={cn('rounded-lg border p-4 transition-all', statusCls(d.status), expandedDim === d.key ? 'ring-2 ring-primary/20' : '')}
        >
          <button
            type="button"
            className="w-full flex items-center gap-3 text-left"
            onClick={() => setExpandedDim(expandedDim === d.key ? null : d.key)}
          >
            {statusIcon(d.status)}
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">{d.label}</p>
              <p className="text-xs text-muted-foreground">{d.detail}</p>
            </div>
            <ChevronRight className={cn('h-4 w-4 text-muted-foreground transition-transform', expandedDim === d.key && 'rotate-90')} />
          </button>

          {expandedDim === d.key && (
            <div className="mt-3 pt-3 border-t space-y-2">
              {(d.key === 'metadata' || d.key === 'ownership' || d.key === 'governance') && (
                <Button size="sm" variant="outline" onClick={onEditProject} disabled={!canEdit} title={!canEdit ? READ_ONLY_TOOLTIP : undefined}>
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Edit Project
                </Button>
              )}

              {d.key === 'artifacts' && categoryArtifacts.length > 0 && (
                <div className="space-y-1.5">
                  {categoryArtifacts.map((art) => {
                    const status = statuses.find((s) => s['_pmo_requiredartifact_value'] === art.pmo_requiredartifactid);
                    const sv = status?.pmo_status ?? ARTIFACT_STATUS.NotStarted;
                    const isComplete = sv === ARTIFACT_STATUS.Complete || sv === ARTIFACT_STATUS.Waived;
                    return (
                      <div key={art.pmo_requiredartifactid} className="flex items-center gap-2 py-1">
                        {isComplete ? <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />}
                        <span className={cn('text-sm flex-1', isComplete && 'text-muted-foreground line-through')}>{art.pmo_name}</span>
                        {!isComplete && canEdit && (
                          <div className="flex gap-1">
                            <button type="button" onClick={() => handleArtifactAction(art.pmo_requiredartifactid, 'complete')} className="text-[10px] text-emerald-600 hover:underline">Complete</button>
                            <button type="button" onClick={() => handleArtifactAction(art.pmo_requiredartifactid, 'inprogress')} className="text-[10px] text-blue-600 hover:underline">In Progress</button>
                            <button type="button" onClick={() => handleArtifactAction(art.pmo_requiredartifactid, 'waive')} className="text-[10px] text-muted-foreground hover:underline">Waive</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {d.key === 'template' && d.status === 'missing' && (
                <p className="text-xs text-muted-foreground">Apply a template from the project onboarding wizard or manually create tasks in the Tasks tab.</p>
              )}

              {d.key === 'traceability' && sourceRequest && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Originating Request:</span>
                    <a href={`/intake/${sourceRequest.pmo_projectrequestid}`} className="text-xs text-primary hover:underline font-medium">
                      {sourceRequest.pmo_autonumber ?? sourceRequest.pmo_name}
                    </a>
                  </div>
                  {sourceRequest['_pmo_intakeworkflowid_value@OData.Community.Display.V1.FormattedValue'] && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Workflow:</span>
                      <span className="text-xs font-medium">{sourceRequest['_pmo_intakeworkflowid_value@OData.Community.Display.V1.FormattedValue']}</span>
                    </div>
                  )}
                  {sourceRequest.pmo_approvalchain && (() => {
                    try {
                      const chain: ApprovalAction[] = JSON.parse(sourceRequest.pmo_approvalchain);
                      const approvals = chain.filter((a) => a.action === 'approved');
                      if (approvals.length === 0) return null;
                      return (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Approval Chain:</p>
                          {approvals.map((a, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs">
                              <Check className="h-3 w-3 text-emerald-500" />
                              <span>Stage {a.stageOrder + 1} — {a.actorName} ({new Date(a.timestamp).toLocaleDateString()})</span>
                            </div>
                          ))}
                        </div>
                      );
                    } catch { return null; }
                  })()}
                </div>
              )}

              {d.key === 'traceability' && !sourceRequest && (
                <p className="text-xs text-muted-foreground">This project was created outside the governed intake workflow. No intake traceability data is available.</p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
