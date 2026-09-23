/**
 * UatProjectSettingsPanel — one project's UAT settings.
 *
 * **Absence of a row means inherit, and this panel is careful not to destroy that.** ~2,026
 * projects have no settings row, which is why the table could be introduced without touching
 * any of them. So the enablement control has THREE states, not two: Inherit, On, Off — and
 * Inherit is what "no row" means. A two-state switch would force a row onto every project the
 * first time someone looked at this panel, and "inherit" would stop existing.
 *
 * **Saving is an upsert against the alternate key**, so a double submit cannot create a second
 * row — the platform refuses it and `upsertUatProjectSetting` replays the loser as an update.
 * See that function for why the key rather than a pre-check is the guarantor.
 *
 * **The ITPR is a single editable reference field.** Not a list, not a lookup, and validated
 * against nothing: the IT staff who own those numbers have no access to this application, so a
 * validation rule here could only ever be wrong about someone else's data (G-ITPR, owner
 * answer 2026-08-29).
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { toast } from '../../../hooks/useToast';
import { useDataSource } from '../../../lib/taskSource';
import { useUatProjectSetting } from '../../../hooks/useUatDefects';
import { upsertUatProjectSetting } from '../../../api/uatProjectSettings.api';
import { useQueryClient } from '@tanstack/react-query';
import { TemplatePicker } from './TemplatePicker';
import { UatBypassDialog } from './UatBypassDialog';
import type { UatProjectSetting } from '../../../models/uatDefect.model';

/** The three states the enablement control can be in. "inherit" is the absence of an answer. */
export type EnablementChoice = 'inherit' | 'on' | 'off';

/** A settings row's `pmo_uatenabled` → the control's state. Null and absent both inherit. */
export function enablementOf(setting: UatProjectSetting | undefined): EnablementChoice {
  if (!setting || setting.pmo_uatenabled === null || setting.pmo_uatenabled === undefined) {
    return 'inherit';
  }
  return setting.pmo_uatenabled ? 'on' : 'off';
}

/** The control's state → what to write. `null` is a real, meaningful value here. */
export function enabledValueFor(choice: EnablementChoice): boolean | null {
  if (choice === 'inherit') return null;
  return choice === 'on';
}

export interface UatProjectSettingsPanelProps {
  projectId: string;
}

export function UatProjectSettingsPanel({ projectId }: UatProjectSettingsPanelProps) {
  const qc = useQueryClient();
  const dataSource = useDataSource();
  const { data: settings = [], isPending, isError, refetch } = useUatProjectSetting(projectId);
  const setting = settings[0];

  const [choice, setChoice] = useState<EnablementChoice | null>(null);
  const [itpr, setItpr] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [bypassOpen, setBypassOpen] = useState(false);

  // Local state starts as null meaning "not edited", so the panel shows the saved value until
  // the operator changes something. Reading the row into state with an effect is what the lint
  // rule refuses and what makes a form silently overwrite a value that arrived late.
  const shownChoice = choice ?? enablementOf(setting);
  const shownItpr = itpr ?? setting?.pmo_itprnumber ?? '';
  const shownTemplate = templateId !== undefined ? templateId : (setting?._pmo_defaulttemplate_value ?? null);

  const dirty = choice !== null || itpr !== null || templateId !== undefined;

  async function handleSave() {
    setSaving(true);
    try {
      await upsertUatProjectSetting(projectId, dataSource, {
        pmo_uatenabled: enabledValueFor(shownChoice),
        pmo_itprnumber: shownItpr.trim() || null,
        'pmo_DefaultTemplate@odata.bind': shownTemplate
          ? `/pmo_uattemplates(${shownTemplate})`
          : null,
      });
      // Both the settings read and the tab's own enablement check must see this immediately —
      // a saved "off" that leaves the tab showing content is the defect this control exists
      // to avoid.
      void qc.invalidateQueries({ queryKey: ['uatProjectSetting', projectId] });
      setChoice(null);
      setItpr(null);
      setTemplateId(undefined);
      toast.success('UAT settings saved.');
    } catch (error) {
      toast.error(
        `Couldn't save the UAT settings: ${error instanceof Error ? error.message : String(error)}`,
        { action: 'save UAT project settings', parentProjectId: projectId },
      );
    } finally {
      setSaving(false);
    }
  }

  if (isPending) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading UAT settings…
      </p>
    );
  }
  if (isError) {
    return (
      <div className="space-y-2" role="alert">
        {/* Never "not configured": a failed read claiming inherit would invite an operator to
            set it again and overwrite a real answer. */}
        <p className="text-sm text-destructive">
          The UAT settings could not be loaded. This is a read failure — the saved settings are
          unchanged.
        </p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>Try again</Button>
      </div>
    );
  }

  return (
    <section className="space-y-4" aria-label="UAT settings" data-testid="uat-project-settings">
      <div className="space-y-1.5">
        <Label htmlFor="uat-enabled">UAT for this project</Label>
        <select
          id="uat-enabled"
          className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-2 text-sm"
          value={shownChoice}
          onChange={(e) => setChoice(e.target.value as EnablementChoice)}
        >
          <option value="inherit">Inherit (follow the organisation and team settings)</option>
          <option value="on">On for this project</option>
          <option value="off">Off for this project</option>
        </select>
        <p className="text-xs text-muted-foreground">
          {shownChoice === 'inherit'
            ? 'No project-level answer is stored. UAT follows the organisation and team settings.'
            : shownChoice === 'off'
              ? 'This project\'s UAT tab is hidden. Other projects are unaffected.'
              : 'On, unless the organisation or the team has turned UAT off — a project cannot '
                + 'grant what has been withdrawn above it.'}
        </p>
      </div>

      <div className="space-y-1.5 max-w-xs">
        <Label htmlFor="uat-itpr">ITPR number</Label>
        <Input
          id="uat-itpr"
          value={shownItpr}
          onChange={(e) => setItpr(e.target.value)}
          placeholder="e.g. ITPR-12345"
        />
        <p className="text-xs text-muted-foreground">
          A reference only. It is not checked against any system — the IT staff who own these
          numbers have no access to this application.
        </p>
      </div>

      <div className="max-w-md">
        {/* The shared picker's second consumer, which finding 41 required: every template
            picker shows name · version · active, so two versions of one template are never
            indistinguishable. It owns its own label and none-wording — a project with no
            default template just has no default, which is a different thing from a test case
            with no template being ad hoc. */}
        <TemplatePicker
          id="uat-default-template"
          label="Default test template"
          value={shownTemplate}
          onChange={(id) => setTemplateId(id)}
          noneLabel="No default — the tester chooses"
          description={'Offered first when a test case is created on this project. A tester can '
            + 'still choose another or create an ad-hoc case.'}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void handleSave()} disabled={!dirty || saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          Save settings
        </Button>
        <Button size="sm" variant="outline" onClick={() => setBypassOpen(true)}>
          {setting?.pmo_bypassuat ? 'Review the UAT bypass' : 'Bypass UAT for this project'}
        </Button>
      </div>

      {setting?.pmo_bypassuat && (
        <p className="text-xs text-amber-700" role="status">
          UAT is bypassed for this project
          {setting.pmo_bypassdecidedon ? ` (decided ${setting.pmo_bypassdecidedon.slice(0, 10)})` : ''}.
          It is excluded from portfolio coverage and pace.
        </p>
      )}

      <UatBypassDialog
        open={bypassOpen}
        onOpenChange={setBypassOpen}
        projectId={projectId}
        setting={setting}
      />
    </section>
  );
}

export default UatProjectSettingsPanel;
