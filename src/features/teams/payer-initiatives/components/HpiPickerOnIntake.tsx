/**
 * HpiPickerOnIntake — slot component mounted in IntakeDetailPage at the
 * "intake.afterTeamPicker" slot for Payer Initiatives members (and admins
 * acting-as Payer Initiatives).
 *
 * On approval/conversion, the intake row's HPI lookup is read by
 * intakeConversion / intakeAutoConvert and copied onto the new
 * msdyn_project. (Persistence on the intake row itself uses the same
 * pmo_HpiIssue lookup column, mirrored on pmo_projectrequest.)
 *
 * Slot props contract (host: IntakeDetailPage):
 *   {
 *     intakeId: string,                         // pmo_projectrequest GUID
 *     currentHpiId?: string,                    // pre-existing HPI id, if any
 *     canEdit: boolean,                         // gate the picker on the same
 *                                               // routing/edit gate as Target Team
 *   }
 */
import { useState } from 'react';
import * as dv from '../../../../lib/dataverseClient';
import { ENTITY_SETS } from '../../../../lib/constants';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../../components/ui/button';
import { toast } from '../../../../hooks/useToast';
import { Tag, Loader2 } from 'lucide-react';
import { useHpiIssues } from '../hooks/useHpiIssues';
import { hpiDisplayName } from '../api/hpi.api';

interface SlotProps {
  intakeId?: unknown;
  currentHpiId?: unknown;
  currentHpiLabel?: unknown;
  canEdit?: unknown;
}

export default function HpiPickerOnIntake(props: SlotProps) {
  const intakeId = typeof props.intakeId === 'string' ? props.intakeId : undefined;
  const currentHpiId = typeof props.currentHpiId === 'string' ? props.currentHpiId : undefined;
  const currentHpiLabel = typeof props.currentHpiLabel === 'string' ? props.currentHpiLabel : undefined;
  const canEdit = props.canEdit === true;

  const qc = useQueryClient();
  const { data: issues = [], isLoading } = useHpiIssues();
  const [draft, setDraft] = useState<string>(currentHpiId ?? '');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  function begin() {
    setDraft(currentHpiId ?? '');
    setEditing(true);
  }
  function cancel() {
    setEditing(false);
    setDraft(currentHpiId ?? '');
  }

  async function save() {
    if (!intakeId) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        'pmo_PayerInitiatives_HpiIssue@odata.bind': draft ? `/${ENTITY_SETS.hpiIssue}(${draft})` : null,
      };
      await dv.update(ENTITY_SETS.projectRequest, intakeId, payload);
      // Invalidate the intake detail query so the new HPI label shows
      // without a hard refresh. Key shape mirrors IntakeDetailPage's
      // ['intake', id] query.
      qc.invalidateQueries({ queryKey: ['intake', intakeId] });
      toast.success(draft ? 'HPI linked.' : 'HPI cleared.');
      setEditing(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Couldn’t save HPI: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  const labelForCurrent = currentHpiLabel ?? (
    currentHpiId ? issues.find((i) => i.rcm_payerdeckissueid === currentHpiId)?.rcm_issuenumber : undefined
  );

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
        <Tag className="h-3 w-3" />
        HPI Issue (Payer Initiatives)
      </p>
      {!editing ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-foreground">
            {labelForCurrent ?? <span className="italic text-muted-foreground">No HPI linked</span>}
          </p>
          {canEdit && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={begin}>
              {currentHpiId ? 'Change' : 'Link HPI'}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading HPI list…
            </div>
          ) : (
            <select
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">— None —</option>
              {issues.map((i) => (
                <option key={i.rcm_payerdeckissueid} value={i.rcm_payerdeckissueid}>
                  {i.rcm_issuenumber ?? '—'} — {hpiDisplayName(i)}
                </option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={cancel} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
