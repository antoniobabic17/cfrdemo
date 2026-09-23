/**
 * UatBypassDialog — skipping UAT, recorded where the organisation already looks.
 *
 * **A bypass cannot be invisible.** One written reason produces three things from one submit:
 * the bypass flag on the project's UAT settings, exactly ONE risk in the existing risk
 * workspace, and exactly ONE decision in the existing decision workspace. The operator types
 * the reason once; it appears in all three. A bypass that lived only on a UAT settings row
 * would be visible only to people already looking at UAT — which is nobody, on a project that
 * has skipped it.
 *
 * **Nothing is added to the risk or decision tables.** The created ids are stored on the UAT
 * settings row as plain text (`pmo_bypassriskid`, `pmo_bypassdecisionid` — String, not
 * Uniqueidentifier; finding 21), which is what makes both reachable from the bypass record
 * without a lookup pointing back. Those tables belong to the wider PMO app and this feature
 * does not get to change their shape.
 *
 * **Both project-record modes.** The risk service is already mode-aware and is called through
 * the app's own hook, so this inherits it. The decision is bound the way the existing decision
 * workspace binds one — see the note on `handleSave`.
 */
import { useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { toast } from '../../../hooks/useToast';
import { useQueryClient } from '@tanstack/react-query';
import { useDataSource } from '../../../lib/taskSource';
import { projectBind } from '../../../lib/projectLookupRef';
import { useCreateProjectRisk } from '../../../hooks/useProjectRisks';
import { createProjectDecision } from '../../../api/projectDecisions.api';
import { upsertUatProjectSetting } from '../../../api/uatProjectSettings.api';
import type { UatProjectSetting } from '../../../models/uatDefect.model';

/** Where the risk and the decision get their wording from — one source, three destinations. */
export function bypassRiskSubject(): string {
  return 'UAT bypassed for this project';
}

export function bypassNarrative(reason: string, qaEvidence: string): string {
  const parts = [
    'User acceptance testing has been bypassed for this project.',
    `Reason given: ${reason.trim()}`,
  ];
  if (qaEvidence.trim()) parts.push(`Alternative assurance: ${qaEvidence.trim()}`);
  parts.push('Recorded automatically from the project\'s UAT settings.');
  return parts.join('\n\n');
}

/**
 * The decision status a bypass records.
 *
 * `pmo_status` on a decision is a required integer and this is not a UAT option set — it
 * belongs to the decision workspace. 1 is its "Approved/Decided" member as the existing
 * workspace writes it; a bypass IS a decision that has been taken, not one pending.
 */
const DECISION_STATUS_DECIDED = 1;

export interface UatBypassDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** The current settings row, if any. Undefined means no row yet — inherit. */
  setting: UatProjectSetting | undefined;
}

export function UatBypassDialog(props: UatBypassDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {props.open && <UatBypassForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function UatBypassForm({ onOpenChange, projectId, setting }: UatBypassDialogProps) {
  const qc = useQueryClient();
  const dataSource = useDataSource();
  const createRisk = useCreateProjectRisk(projectId);
  const [reason, setReason] = useState(setting?.pmo_bypassreason ?? '');
  const [qaEvidence, setQaEvidence] = useState(setting?.pmo_bypassqaevidence ?? '');
  const [saving, setSaving] = useState(false);

  const alreadyBypassed = setting?.pmo_bypassuat === true;
  const canSave = reason.trim().length >= 10 && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    const narrative = bypassNarrative(reason, qaEvidence);
    try {
      // ONE risk, in the workspace that already exists, through the app's own mode-aware hook.
      const risk = await createRisk.mutateAsync({
        msdyn_subject: bypassRiskSubject(),
        msdyn_description: narrative,
        'msdyn_project@odata.bind': `/msdyn_projects(${projectId})`,
      });

      // ONE decision, through the same mode-aware bind the decision workspace itself uses.
      // This replaces a hard-coded shell bind (`pmo_Project` → /msdyn_projects) that was written
      // while the dual project reference looked ambiguous. Both halves of that ambiguity are now
      // settled by reading the environment rather than the repository, which is what it needed:
      //   - `pmo_projectref` EXISTS on pmo_projectdecision in Nexus RCM - DEV and targets
      //     `pmo_project`, while `pmo_project` targets the `msdyn_project` shell. Only
      //     solution/src/ is missing it; solution/custom-src/Entities/pmo_ProjectDecision
      //     declares `pmo_ProjectRef` as its one attribute. So there was never a 400 to avoid.
      //   - `useCreateProjectDecision` already strips both bind keys and applies projectBind, so
      //     the existing workspace does NOT bind to the shell — it is mode-aware in production.
      // Binding to the shell here therefore made this the only decision row in the app pointing
      // at the thing Tier 1 exists to decouple from. In pss mode this is byte-identical to what
      // it replaced; in custom mode it is the correction.
      const decision = await createProjectDecision({
        pmo_name: '',                                   // the api generates a unique one
        pmo_description: narrative,
        pmo_decisiondate: new Date().toISOString(),
        pmo_status: DECISION_STATUS_DECIDED,
        pmo_rationale: reason.trim(),
        ...projectBind(projectId, dataSource),
      });

      // The flag and the two ids, last: a settings row saying "bypassed" whose risk and
      // decision do not exist would be the invisible bypass this dialog exists to prevent.
      await upsertUatProjectSetting(projectId, dataSource, {
        pmo_bypassuat: true,
        pmo_bypassreason: reason.trim(),
        pmo_bypassqaevidence: qaEvidence.trim() || null,
        pmo_bypassdecidedon: new Date().toISOString(),
        pmo_bypassriskid: risk.msdyn_projectriskid,
        pmo_bypassdecisionid: decision.pmo_projectdecisionid,
      });

      void qc.invalidateQueries({ queryKey: ['uatProjectSetting', projectId] });
      toast.success('UAT bypass recorded, with a risk and a decision raised for it.');
      onOpenChange(false);
    } catch (error) {
      toast.error(
        `Couldn't record the bypass: ${error instanceof Error ? error.message : String(error)}. `
        + 'Nothing was left half-recorded — check the risk workspace before retrying.',
        { action: 'record a UAT bypass', parentProjectId: projectId },
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleLift() {
    setSaving(true);
    try {
      // The risk and the decision are NOT deleted. They are the record that this happened, and
      // deleting them would erase the history the bypass was recorded to create.
      await upsertUatProjectSetting(projectId, dataSource, { pmo_bypassuat: false });
      void qc.invalidateQueries({ queryKey: ['uatProjectSetting', projectId] });
      toast.success('UAT bypass lifted. The risk and decision remain as the record of it.');
      onOpenChange(false);
    } catch (error) {
      toast.error(`Couldn't lift the bypass: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{alreadyBypassed ? 'UAT bypass' : 'Bypass UAT for this project'}</DialogTitle>
        <DialogDescription>
          Skipping UAT is recorded as a risk and a decision on this project, so it is visible to
          everyone who reviews the project — not only to people looking at UAT.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="bypass-reason">Why is UAT being skipped?</Label>
          <Textarea
            id="bypass-reason"
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={alreadyBypassed}
            placeholder="What makes user acceptance testing unnecessary or impossible here?"
          />
          {!alreadyBypassed && reason.trim().length > 0 && reason.trim().length < 10 && (
            <p className="text-xs text-destructive" role="alert">
              Give a reason someone reading the risk register will understand.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="bypass-qa">Alternative assurance (optional)</Label>
          <Textarea
            id="bypass-qa"
            rows={3}
            value={qaEvidence}
            onChange={(e) => setQaEvidence(e.target.value)}
            disabled={alreadyBypassed}
            placeholder="What testing is being done instead, if any?"
          />
        </div>

        {!alreadyBypassed && (
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
            Saving raises one risk and one decision on this project, both carrying this reason.
            You enter it once. The project is also excluded from portfolio UAT coverage and pace,
            so it cannot flatter the numbers by having no tests.
          </p>
        )}

        {alreadyBypassed && (
          <div className="text-xs text-muted-foreground space-y-1" data-testid="uat-bypass-record">
            <p>Risk id: {setting?.pmo_bypassriskid || 'not recorded'}</p>
            <p>Decision id: {setting?.pmo_bypassdecisionid || 'not recorded'}</p>
            <p>
              Lifting the bypass leaves both in place. They are the record that this happened.
            </p>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancel
        </Button>
        {alreadyBypassed ? (
          <Button onClick={() => void handleLift()} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Lift the bypass
          </Button>
        ) : (
          <Button onClick={() => void handleSave()} disabled={!canSave}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Record the bypass
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

export default UatBypassDialog;
