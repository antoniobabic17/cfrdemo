import { useState } from 'react';
import { Save, Loader2, ChevronDown, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../ui/dialog';
import { useQueryClient } from '@tanstack/react-query';
import { useAppSettings, useUpsertSetting } from '../../hooks/useAppSettings';
import { useAdminAudit } from '../../hooks/useAdminAudit';
import { SETTING_FEATURE_TOGGLES } from '../../lib/constants';
import {
  DEFAULT_FEATURE_TOGGLES,
  type FeatureToggles,
} from '../../providers/ConfigurationProvider';
import { UAT_TOGGLE_KEYS } from '../../features/uat/lib/uatToggles';
import { toast } from '../../hooks/useToast';
import { cn } from '../../lib/utils';

interface ToggleItem {
  key: string;
  label: string;
  /** Optional warning message shown when toggling OFF — requires the user to confirm. */
  disableWarning?: string;
}

/** A subsection within a group — items grouped by sub-heading. */
interface ToggleSubSection {
  heading: string;
  items: ToggleItem[];
}

interface ToggleGroup {
  id: string;
  label: string;
  description: string;
  /** Either a flat list of items, or sub-sections with their own headings. */
  items?: ToggleItem[];
  subSections?: ToggleSubSection[];
}

const TOGGLE_GROUPS: ToggleGroup[] = [
  {
    id: 'left-nav',
    label: 'Left Navigation',
    description: 'Items shown in the left sidebar — grouped by category',
    subSections: [
      {
        heading: 'General',
        items: [
          { key: 'nav.dashboard', label: 'Dashboard' },
          { key: 'nav.intakeQueue', label: 'Intake Queue' },
        ],
      },
      {
        heading: 'Portfolio',
        items: [
          { key: 'nav.projects', label: 'Projects' },
          { key: 'nav.programs', label: 'Programs' },
          { key: 'nav.statusReports', label: 'Status Reports' },
        ],
      },
      {
        heading: 'Analytics & Reporting',
        items: [
          { key: 'nav.analyticsOverview', label: 'Overview' },
          { key: 'nav.analyticsByTeam', label: 'By Team' },
          { key: 'nav.analyticsPipeline', label: 'Pipeline' },
          { key: 'nav.analyticsHealth', label: 'Health Matrix' },
          { key: 'nav.analyticsSchedule', label: 'Schedule' },
          { key: 'nav.analyticsGovernance', label: 'Governance' },
          { key: 'nav.analyticsCapacity', label: 'Capacity' },
          { key: 'nav.analyticsPrioritization', label: 'Prioritization' },
          { key: 'nav.analyticsFinancials', label: 'Financials' },
          { key: 'nav.analyticsScenarios', label: 'Scenarios' },
          { key: 'nav.analyticsVariance', label: 'Variance' },
          { key: 'nav.analyticsRoadmap', label: 'Roadmap' },
          { key: 'nav.analyticsIntakePipeline', label: 'Intake Analytics' },
          { key: 'nav.analyticsRoutingQa', label: 'Routing QA' },
        ],
      },
    ],
  },
  {
    id: 'header',
    label: 'Header Toolbar',
    description: 'Top-right header buttons (notifications are always visible)',
    items: [
      { key: 'header.themeToggle', label: 'Theme Toggle (Light/Dark)' },
      { key: 'header.shortcuts', label: 'Keyboard Shortcuts' },
      { key: 'header.askMira', label: 'Ask Mira' },
    ],
  },
  {
    id: 'intake-cards',
    label: 'Intake Request Types',
    description: 'Cards shown on the "Submit Request" screen (workflows + feedback)',
    subSections: [
      {
        heading: 'Programs',
        items: [
          { key: 'intakeCard.programIntake5Stage', label: 'Standard Program Intake (5-Stage)' },
          { key: 'intakeCard.programRequest',      label: 'Standard Program Request' },
        ],
      },
      {
        heading: 'Projects',
        items: [
          { key: 'intakeCard.projectIntake5Stage', label: 'Standard Project Intake (5-Stage)' },
          { key: 'intakeCard.projectRequest',      label: 'Standard Project Request' },
        ],
      },
      {
        heading: 'Feedback',
        items: [
          { key: 'intakeCard.feedbackBug',         label: 'Report a Bug' },
          { key: 'intakeCard.feedbackEnhancement', label: 'Suggest an Enhancement' },
        ],
      },
    ],
  },
  {
    id: 'intake-flow',
    label: 'Intake Flow',
    description: 'Behavior of the intake submission process',
    items: [
      {
        key: 'intake.bypassApproval',
        label: 'Bypass approval — auto-approve & convert on submit',
        disableWarning:
          'When ON, intake submissions that have all required project-conversion fields will be auto-approved and converted into a project (or program) immediately, skipping the approval queue entirely.\n\n'
          + 'You are turning this OFF, so future submissions will go back through the normal approval flow. In-flight requests are not affected.',
      },
    ],
  },
  {
    id: 'project-detail-tabs',
    label: 'Project Detail Tabs',
    description: 'Tabs shown on the project detail page (Overview, Plan, Tasks, etc.)',
    items: [
      {
        key: 'projectTab.overview',
        label: 'Overview',
        disableWarning:
          'Overview is the default landing tab for projects. With it hidden, the project page will open on the next available tab. Cross-tab links from Overview (Latest Update, quick stats) also disappear.',
      },
      {
        key: 'projectTab.plan',
        label: 'Plan',
        disableWarning:
          'Hiding Plan also hides:\n• Project Document Library (file uploads + browsing)\n• Business Case and Value Statement\n• Team Members management\n\nDocuments already uploaded remain in storage but will not be visible from the project page until Plan is re-enabled.',
      },
      {
        key: 'projectTab.tasks',
        label: 'Tasks',
        disableWarning:
          'Hiding Tasks removes access to the WBS, schedule editing, dependencies, and resource assignments from the project page.\n\nExisting tasks remain in Dataverse and continue to feed analytics, capacity views, and rollups; only the in-app editing UI is hidden.',
      },
      {
        key: 'projectTab.monitor',
        label: 'Monitor',
        disableWarning:
          'Hiding Monitor removes access to Risks, Issues, Changes, and Decisions for this project.\n\nExisting records remain in Dataverse but cannot be created, edited, or deleted from the project page until re-enabled. Cross-tab links from Overview quick stats also disappear.',
      },
      {
        key: 'projectTab.govern',
        label: 'Govern',
        disableWarning:
          'Hiding Govern removes access to gate approvals, the initiation workspace, and closeout.\n\nIn-flight gate approvals will not be reachable from the project page until re-enabled.',
      },
      {
        key: 'projectTab.collaborate',
        label: 'Collaborate',
        disableWarning:
          'Hiding Collaborate removes access to contributing teams management and project meetings from the project page.\n\nExisting team assignments remain.',
      },
      {
        key: 'projectTab.status',
        label: 'Status',
        disableWarning:
          'Hiding Status removes access to status reports for this project.\n\nExisting reports remain in Dataverse and still feed Overview\'s "Latest Update" card. New reports cannot be created from the project page until re-enabled.',
      },
    ],
  },
  {
    id: 'uat-manager',
    label: 'UAT Manager',
    description:
      'User-acceptance testing. On by default for everyone; a team can opt itself out, and a project can opt itself out.',
    subSections: [
      {
        heading: 'Where it appears',
        items: [
          {
            key: UAT_TOGGLE_KEYS.nav,
            label: 'Left navigation entry',
            disableWarning:
              'Hiding the UAT nav entry removes the cross-project UAT area.\\n\\nThe per-project UAT tab is a separate switch and stays visible unless you turn that off too. Existing templates, test cases, runs and defects remain in Dataverse.',
          },
          {
            key: UAT_TOGGLE_KEYS.projectTab,
            label: 'Project detail tab',
            disableWarning:
              'Hiding the UAT tab removes test execution, evidence and defects from the project page.\\n\\nRuns already recorded remain in Dataverse and keep feeding coverage reporting; only the in-app surface is hidden.',
          },
        ],
      },
      {
        heading: 'Capabilities',
        items: [
          {
            key: UAT_TOGGLE_KEYS.templates,
            label: 'Template authoring',
            disableWarning:
              'Hiding template authoring stops questions being added, edited or reordered.\\n\\nExisting templates keep driving test cases; this only removes the editor. Turning it off does NOT freeze historical runs -- their question text is snapshotted per answer.',
          },
          {
            key: UAT_TOGGLE_KEYS.requirements,
            label: 'Requirement backlog',
            disableWarning:
              'Hiding the backlog removes epic/story authoring and the parent hierarchy.\\n\\nCoverage links to existing requirements remain and continue to report.',
          },
          {
            key: UAT_TOGGLE_KEYS.coverage,
            label: 'Coverage reporting',
            disableWarning:
              'Hiding coverage removes the requirement-to-test-case traceability view and its percentages.\\n\\nThe links themselves remain; nothing is unlinked.',
          },
          {
            key: UAT_TOGGLE_KEYS.defects,
            label: 'Defect tracking',
            disableWarning:
              'Hiding defects removes raising and triaging them from the UAT surface.\\n\\nExisting defects remain in Dataverse. A defect outlives the run that found it by design, so nothing is lost -- but testers will have no way to record a new one.',
          },
          {
            key: UAT_TOGGLE_KEYS.import,
            label: 'Spreadsheet import',
            disableWarning:
              'Hiding import removes bulk test-case creation from a spreadsheet.\\n\\nStaged batches remain. A batch part-way through a commit is safe to leave: a staged row that already created a test case is skipped on re-commit, so finishing later cannot duplicate anything.',
          },
        ],
      },
    ],
  },
];

interface PendingDisable {
  key: string;
  label: string;
  warning: string;
}

/** Flatten a group's items (whether subsection-based or flat). */
function getAllItems(group: ToggleGroup): ToggleItem[] {
  if (group.items) return group.items;
  if (group.subSections) return group.subSections.flatMap((s) => s.items);
  return [];
}

function ItemCheckbox({ item, toggles, onToggle, onRequestDisable }: {
  item: ToggleItem;
  toggles: FeatureToggles;
  onToggle: (key: string) => void;
  onRequestDisable: (item: ToggleItem) => void;
}) {
  function handleClick() {
    const currentlyOn = toggles[item.key] !== false;
    if (currentlyOn && item.disableWarning) {
      onRequestDisable(item);
      return;
    }
    onToggle(item.key);
  }
  return (
    <label className="flex items-center gap-2.5 py-1.5 cursor-pointer hover:bg-muted/20 rounded px-1 -mx-1 transition-colors">
      <input
        type="checkbox"
        checked={toggles[item.key] !== false}
        onChange={handleClick}
        className="h-3.5 w-3.5 rounded border-border accent-primary shrink-0"
      />
      <span className="text-sm text-foreground flex-1">{item.label}</span>
      {item.disableWarning && (
        <span title="Disabling this has side effects" className="text-amber-500 shrink-0">
          <AlertTriangle className="h-3 w-3" />
        </span>
      )}
    </label>
  );
}

function ToggleGroupPanel({ group, toggles, onToggle, onRequestDisable }: {
  group: ToggleGroup;
  toggles: FeatureToggles;
  onToggle: (key: string) => void;
  onRequestDisable: (item: ToggleItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const allItems = getAllItems(group);
  const enabledCount = allItems.filter((i) => toggles[i.key] !== false).length;
  const allEnabled = enabledCount === allItems.length;

  function toggleAll() {
    const target = !allEnabled;
    allItems.forEach((i) => {
      const currentlyOn = toggles[i.key] !== false;
      if (currentlyOn === target) return;
      if (!target && i.disableWarning) {
        onRequestDisable(i);
      } else {
        onToggle(i.key);
      }
    });
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
      >
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', !open && '-rotate-90')} />
        <div className="flex-1 text-left">
          <p className="text-sm font-medium text-foreground">{group.label}</p>
          <p className="text-xs text-muted-foreground">{group.description}</p>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{enabledCount}/{allItems.length} enabled</span>
      </button>

      {open && (
        <div className="border-t px-4 py-2 bg-muted/10">
          {allItems.length > 1 && (
            <label className="flex items-center gap-2.5 py-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={allEnabled}
                onChange={toggleAll}
                className="h-3.5 w-3.5 rounded border-border accent-primary shrink-0"
              />
              <span className="text-xs font-medium text-muted-foreground italic">Toggle all</span>
            </label>
          )}

          {/* Sub-section style */}
          {group.subSections && (
            <div className="space-y-3 mt-1">
              {group.subSections.map((sub) => (
                <div key={sub.heading} className="space-y-0.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80 pt-1.5 pb-0.5">
                    {sub.heading}
                  </p>
                  {sub.items.map((item) => (
                    <ItemCheckbox
                      key={item.key}
                      item={item}
                      toggles={toggles}
                      onToggle={onToggle}
                      onRequestDisable={onRequestDisable}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Flat list style */}
          {group.items && (
            <div className="space-y-0.5 mt-1">
              {group.items.map((item) => (
                <ItemCheckbox
                  key={item.key}
                  item={item}
                  toggles={toggles}
                  onToggle={onToggle}
                  onRequestDisable={onRequestDisable}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface FeatureToggleSectionProps {
  /** Defaults to the global key (SETTING_FEATURE_TOGGLES). When provided, the
   *  editor reads/writes a per-scope key like 'pmo.team_toggles.{teamId}'. */
  storageKey?: string;
  /** Display name for the scope, used in the heading + save toast. Defaults
   *  to 'Global'. */
  scopeLabel?: string;
}

export function FeatureToggleSection({ storageKey, scopeLabel }: FeatureToggleSectionProps = {}) {
  const settingKey = storageKey ?? SETTING_FEATURE_TOGGLES;
  const label = scopeLabel ?? 'Global';
  const { data: settings = [] } = useAppSettings();
  const upsert = useUpsertSetting();
  const audit = useAdminAudit();
  const qc = useQueryClient();

  const existing = settings.find((s) => s.pmo_key === settingKey);
  let parsed: FeatureToggles = { ...DEFAULT_FEATURE_TOGGLES };
  if (existing?.pmo_value) {
    try { parsed = { ...DEFAULT_FEATURE_TOGGLES, ...JSON.parse(existing.pmo_value) }; } catch { /* use defaults */ }
  }

  const [toggles, setToggles] = useState<FeatureToggles>({ ...parsed });
  const [saving, setSaving] = useState(false);
  const [pendingDisable, setPendingDisable] = useState<PendingDisable | null>(null);

  const hasChanges = JSON.stringify(toggles) !== JSON.stringify(parsed);

  function handleToggle(key: string) {
    setToggles((prev) => ({ ...prev, [key]: prev[key] === false ? true : false }));
  }

  function handleRequestDisable(item: ToggleItem) {
    setPendingDisable({ key: item.key, label: item.label, warning: item.disableWarning ?? '' });
  }

  function confirmDisable() {
    if (!pendingDisable) return;
    handleToggle(pendingDisable.key);
    setPendingDisable(null);
  }

  async function handleSave() {
    setSaving(true);
    const newValue = JSON.stringify(toggles);
    const oldValue = existing?.pmo_value ?? null;
    try {
      await upsert.mutateAsync({ key: settingKey, value: newValue });
      audit({ settingKey: settingKey, oldValue, newValue });
      qc.invalidateQueries({ queryKey: ['appSettings'] });
      toast.success(`${label} feature toggles saved.`);
    } catch (err) {
      // A non-admin team lead may lack write access on pmo_appsettings in
      // PROD if their security role is read-only. Surface the message so
      // an admin can grant the required role.
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Couldn’t save toggles: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-foreground">Feature Toggles</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {storageKey
            ? `Override global feature toggles for ${label}. Only OFF takes effect — turning a switch ON here does not grant a feature the global toggle has denied.`
            : 'Enable or disable features across the application. Changes take effect immediately.'}
        </p>
      </div>
      <div className="space-y-2">
        {TOGGLE_GROUPS.map((group) => (
          <ToggleGroupPanel
            key={group.id}
            group={group}
            toggles={toggles}
            onToggle={handleToggle}
            onRequestDisable={handleRequestDisable}
          />
        ))}
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={saving || !hasChanges}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>

      {/* Confirm-before-disable dialog */}
      <Dialog open={pendingDisable !== null} onOpenChange={(o) => { if (!o) setPendingDisable(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Disable "{pendingDisable?.label}"?
            </DialogTitle>
            <DialogDescription className="pt-2 whitespace-pre-line text-sm leading-relaxed">
              {pendingDisable?.warning}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-2">
            <Button variant="secondary" size="sm" onClick={() => setPendingDisable(null)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={confirmDisable}>
              Disable anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
