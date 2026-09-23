/**
 * HpiInlineCreateForm — reusable "create HPI" form body.
 *
 * Shares its field set with HpiCreateDialog but drops the "Attach a Payer
 * Initiatives project" section (used on the intake wizard where the project
 * does not exist yet -- the newly-created HPI is linked to the project the
 * wizard is *about* to create, via extras.hpiIssueId on the intake row).
 *
 * The parent owns the "Save" action so it can integrate the button with the
 * surrounding wizard chrome and block the Continue action while the create
 * is in flight. Consumers should:
 *   1. Hold a ref via `formRef` and call `formRef.current?.submit()` when
 *      they want to persist.
 *   2. Read the `submitting` prop-flag they set in `onSubmittingChange` and
 *      use it to disable their own Continue/Next control.
 *   3. Read `onCreated(newHpiId)` to know when a create succeeded so they
 *      can link the resulting id (e.g. into extras.hpiIssueId).
 */
import { forwardRef, useImperativeHandle, useMemo, useState, useEffect } from 'react';
import { Input } from '../../../../components/ui/input';
import { SearchableSelect } from '../../../../components/common/SearchableSelect';
import { toast } from '../../../../hooks/useToast';
import { useCreateHpiIssue, useHpiIssues } from '../hooks/useHpiIssues';
import { AR_RECOVERY_TYPE_OPTIONS, RISK_OPTIONS, type ArRecoveryTypeValue, type RiskValue } from '../api/hpi.api';
import {
  resolveAnalystLabel,
  useActivePayerInitiativesAnalysts,
} from '../hooks/usePayerInitiativesAnalysts';

export interface HpiInlineCreateFormHandle {
  /** Submit the form. Resolves with the new HPI id on success, or `null`
   *  on validation failure / server error (toast already shown). */
  submit: () => Promise<string | null>;
  /** Reset all fields to empty. */
  reset: () => void;
  /** True iff a required field is filled in enough for submit to succeed. */
  isReady: () => boolean;
}

interface Props {
  /** Fires whenever `create.isPending` toggles, so the parent can disable
   *  its own Continue/Next button while the save is in flight. */
  onSubmittingChange?: (submitting: boolean) => void;
  /** Fires once a create succeeds, with the new payerdeckissue GUID. */
  onCreated?: (newHpiId: string) => void;
  /** Fires when readiness (name filled) changes, so the parent can block
   *  advancing past an un-created but started HPI form. */
  onReadyChange?: (ready: boolean) => void;
}

/** Peek at the current cached list to preview the next Dataverse-assigned
 *  M-XXX. Purely informational -- Dataverse is the source of truth. */
function useNextIssueNumberPreview(): string {
  const { data } = useHpiIssues();
  return useMemo(() => {
    if (!data || data.length === 0) return 'M-1';
    let max = 0;
    for (const row of data) {
      const m = /^M-(\d+)$/.exec(row.rcm_issuenumber ?? '');
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    return `M-${max + 1}`;
  }, [data]);
}

export const HpiInlineCreateForm = forwardRef<HpiInlineCreateFormHandle, Props>(function HpiInlineCreateForm(
  { onSubmittingChange, onCreated, onReadyChange }, ref,
) {
  const create = useCreateHpiIssue();
  const nextPreview = useNextIssueNumberPreview();
  const { data: analystOptions = [], isLoading: analystsLoading } = useActivePayerInitiativesAnalysts();

  const [name, setName] = useState('');
  const [analystId, setAnalystId] = useState('');
  const [payer, setPayer] = useState('');
  const [risk, setRisk] = useState<RiskValue | ''>('');
  const [credentialing, setCredentialing] = useState<boolean | undefined>(undefined);
  const [pathForward, setPathForward] = useState<boolean | undefined>(undefined);
  const [arType, setArType] = useState<ArRecoveryTypeValue | ''>('');

  useEffect(() => {
    onSubmittingChange?.(create.isPending);
  }, [create.isPending, onSubmittingChange]);

  useEffect(() => {
    onReadyChange?.(!!name.trim());
  }, [name, onReadyChange]);

  function reset() {
    setName(''); setAnalystId(''); setPayer('');
    setRisk(''); setCredentialing(undefined);
    setPathForward(undefined); setArType('');
  }

  async function submit(): Promise<string | null> {
    if (!name.trim()) {
      toast.error('Name is required.');
      return null;
    }
    try {
      const row = await create.mutateAsync({
        // "Name" is stored in rcm_statusdetails: the RCM autonumber flow
        // overwrites rcm_name with the M- issue number, so it can't hold a title.
        rcm_statusdetails: name.trim(),
        analystSystemUserId: analystId || undefined,
        rcm_reservebucketpayer: payer.trim() || undefined,
        rcm_risk: risk === '' ? undefined : risk,
        cr87a_credentialing: credentialing,
        cr87a_pathforward: pathForward,
        cr87a_arrecoverytype: arType === '' ? undefined : arType,
      });
      toast.success(`HPI ${row.rcm_issuenumber ?? ''} created.`);
      onCreated?.(row.rcm_payerdeckissueid);
      return row.rcm_payerdeckissueid;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Couldn't create HPI: ${msg}`);
      return null;
    }
  }

  useImperativeHandle(ref, () => ({
    submit,
    reset,
    isReady: () => !!name.trim(),
  }));

  return (
    <div className="space-y-3">
      <Field label="Issue Number">
        <Input
          value={`Auto-generated (next: ${nextPreview})`}
          disabled
          readOnly
          className="text-muted-foreground italic"
        />
        <p className="text-[10px] text-muted-foreground">
          Assigned automatically by Dataverse on save.
        </p>
      </Field>
      <Field label="Name *">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Describe the issue" disabled={create.isPending} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Analyst">
          <SearchableSelect
            value={analystId}
            onChange={setAnalystId}
            options={analystOptions}
            resolveLabel={resolveAnalystLabel}
            placeholder={analystsLoading ? 'Loading team…' : 'Select an analyst…'}
            disabled={analystsLoading || create.isPending}
          />
        </Field>
        <Field label="Reserve Bucket / Payer">
          <Input value={payer} onChange={(e) => setPayer(e.target.value)} disabled={create.isPending} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Risk">
          <select
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
            value={risk === '' ? '' : String(risk)}
            onChange={(e) => setRisk(e.target.value === '' ? '' : (Number(e.target.value) as RiskValue))}
            disabled={create.isPending}
          >
            <option value="">—</option>
            {RISK_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Credentialing">
          <YesNoSelect value={credentialing} onChange={setCredentialing} disabled={create.isPending} />
        </Field>
        <Field label="Path Forward">
          <YesNoSelect value={pathForward} onChange={setPathForward} disabled={create.isPending} />
        </Field>
      </div>
      <Field label="AR Recovery Type">
        <select
          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
          value={arType === '' ? '' : String(arType)}
          onChange={(e) => setArType(e.target.value === '' ? '' : (Number(e.target.value) as ArRecoveryTypeValue))}
          disabled={create.isPending}
        >
          <option value="">—</option>
          {AR_RECOVERY_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>
    </div>
  );
});

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function YesNoSelect({
  value, onChange, disabled,
}: { value: boolean | undefined; onChange: (v: boolean | undefined) => void; disabled?: boolean }) {
  const str = value === undefined ? '' : value ? 'true' : 'false';
  return (
    <select
      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
      value={str}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === '' ? undefined : v === 'true');
      }}
      disabled={disabled}
    >
      <option value="">—</option>
      <option value="true">Yes</option>
      <option value="false">No</option>
    </select>
  );
}
