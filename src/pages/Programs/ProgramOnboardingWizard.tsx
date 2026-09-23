import { useState, useCallback } from 'react';
import { Loader2, ChevronRight, ChevronLeft, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SearchableSelect, type SelectOption } from '../../components/common/SearchableSelect';
import { useCreateProgram } from '../../hooks/usePrograms';
import { useChangeAudit } from '../../hooks/useChangeAudit';
import { toast } from '../../hooks/useToast';
import { toFriendlyError } from '../../lib/utils';
import * as dv from '../../lib/dataverseClient';
import { emitRoleAssigned } from '../../lib/notify';
import {
  ENTITY_SETS, PROG_TYPE, PROG_GOALS, PROG_BUSINESS_UNIT,
  SETTING_USER_SCOPE_GROUP,
} from '../../lib/constants';
import { useQuery } from '@tanstack/react-query';
import { useAppSettings } from '../../hooks/useAppSettings';

interface ProgramOnboardingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (programId: string) => void;
}

const STEPS = ['Basics', 'Ownership', 'Review'] as const;

const USER_BASE_FILTER = "isdisabled eq false and accessmode ne 4 and accessmode ne 5 and applicationid eq null";

interface UserRow { systemuserid: string; fullname: string; lastname: string; firstname: string; }
function fmtUserName(u: UserRow): string {
  if (u.lastname && u.firstname) return `${u.lastname}, ${u.firstname}`;
  return u.fullname;
}

export function ProgramOnboardingWizard({ open, onOpenChange, onCreated }: ProgramOnboardingWizardProps) {
  const createProgram = useCreateProgram();
  const auditChange = useChangeAudit();
  const { data: settings = [] } = useAppSettings();
  const settingMap = Object.fromEntries(settings.map((s) => [s.pmo_key, s]));

  const [step, setStep] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [programType, setProgramType] = useState<string>('');
  const [programGoals, setProgramGoals] = useState<string>('');
  const [businessUnit, setBusinessUnit] = useState<string>('');
  const [programStart, setProgramStart] = useState('');
  const [programDue, setProgramDue] = useState('');

  const [managerId, setManagerId] = useState('');

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

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        msdyn_name: name.trim(),
        msdyn_description: description.trim() || undefined,
      };
      if (programType) payload.proj_programtype = Number(programType);
      if (programGoals) payload.proj_programgoals = Number(programGoals);
      if (businessUnit) payload.proj_businessunit = Number(businessUnit);
      if (programStart) payload.proj_programstart = programStart;
      if (programDue) payload.proj_programdue = programDue;
      if (managerId) payload['proj_Manager@odata.bind'] = `/systemusers(${managerId})`;

      const clean = Object.fromEntries(
        Object.entries(payload).filter(([, v]) => v !== undefined),
      );
      const program = await createProgram.mutateAsync(clean);
      auditChange({
        entityType: 'program',
        entityId: program.msdyn_projectprogramid,
        entityName: name.trim(),
        action: 'create',
      });
      // Notify newly-assigned Program Manager (skip self-assign).
      if (managerId) void emitRoleAssigned({ assigneeUserId: managerId, actorUserId: dv.getCurrentUserId(), role: 'Program Manager', entityKind: 'program', entityId: program.msdyn_projectprogramid, entityName: name.trim() });
      toast.success(`Program "${name.trim()}" created successfully`);
      onOpenChange(false);
      if (onCreated) onCreated(program.msdyn_projectprogramid);
    } catch (e) {
      const msg = toFriendlyError(e, 'Failed to create program');
      setError(msg);
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  const selectCls = "w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Program</DialogTitle>
        </DialogHeader>

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

        {step === 0 && (
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Program Name *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter program name" />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Brief program description"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Program Type</label>
                <select value={programType} onChange={(e) => setProgramType(e.target.value)} className={selectCls}>
                  <option value="">Select...</option>
                  <option value={String(PROG_TYPE.Customer)}>Customer</option>
                  <option value={String(PROG_TYPE.Development)}>Development</option>
                  <option value={String(PROG_TYPE.Support)}>Support</option>
                  <option value={String(PROG_TYPE.Enhancement)}>Enhancement</option>
                  <option value={String(PROG_TYPE.Program)}>Program</option>
                  <option value={String(PROG_TYPE.Other)}>Other</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Goals</label>
                <select value={programGoals} onChange={(e) => setProgramGoals(e.target.value)} className={selectCls}>
                  <option value="">Select...</option>
                  <option value={String(PROG_GOALS.CustomerSatisfaction)}>Customer Satisfaction</option>
                  <option value={String(PROG_GOALS.GrowBusiness)}>Grow Business</option>
                  <option value={String(PROG_GOALS.RunBusiness)}>Run Business</option>
                  <option value={String(PROG_GOALS.Transformation)}>Transformation</option>
                  <option value={String(PROG_GOALS.Other)}>Other</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-sm font-medium">Business Unit</label>
                <select value={businessUnit} onChange={(e) => setBusinessUnit(e.target.value)} className={selectCls}>
                  <option value="">Select...</option>
                  <option value={String(PROG_BUSINESS_UNIT.Enteral)}>Enteral</option>
                  <option value={String(PROG_BUSINESS_UNIT.Epic)}>Epic</option>
                  <option value={String(PROG_BUSINESS_UNIT.InfusionLegacy)}>Infusion Legacy</option>
                  <option value={String(PROG_BUSINESS_UNIT.Medicare)}>Medicare</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Start Date</label>
                <Input type="date" value={programStart} onChange={(e) => setProgramStart(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium">Due Date</label>
                <Input type="date" value={programDue} onChange={(e) => setProgramDue(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Program Manager</label>
              <SearchableSelect value={managerId} onChange={setManagerId} onSearch={searchUsers} resolveLabel={resolveUserLabel} placeholder="Search for manager..." minSearchLength={2} />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-card p-4 space-y-1 text-sm">
              <div><span className="text-muted-foreground">Name:</span> <span className="font-medium">{name}</span></div>
              {description && <div><span className="text-muted-foreground">Description:</span> {description.substring(0, 100)}{description.length > 100 ? '...' : ''}</div>}
              {programType && <div><span className="text-muted-foreground">Type:</span> {programType}</div>}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t">
          <Button variant="ghost" size="sm" onClick={() => step > 0 ? setStep(step - 1) : onOpenChange(false)}>
            <ChevronLeft className="h-3.5 w-3.5 mr-1" />
            {step > 0 ? 'Back' : 'Cancel'}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button size="sm" onClick={() => setStep(step + 1)} disabled={!name.trim()}>
              Next
              <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          ) : (
            <Button size="sm" onClick={handleCreate} disabled={creating || !name.trim()}>
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Check className="h-3.5 w-3.5 mr-1.5" />}
              Create Program
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
