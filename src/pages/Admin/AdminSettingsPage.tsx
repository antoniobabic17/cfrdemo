import { useState } from 'react';
import { Save, X, Check, Loader2, Plus, Pencil, Trash2, AlertTriangle, ChevronRight, ChevronDown } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppSettings, useUpsertSetting, type AppSetting } from '../../hooks/useAppSettings';
import { useProjectTemplates, useCreateTemplate, useUpdateTemplate, useDeactivateTemplate } from '../../hooks/useProjectTemplates';
import { useRequiredArtifacts, useCreateRequiredArtifact, useUpdateRequiredArtifact, useDeactivateRequiredArtifact } from '../../hooks/useRequiredArtifacts';
import type { ProjectTemplate } from '../../models/projectTemplate.model';
import {
  SETTING_FALLBACK_TRIAGE_TEAM, SETTING_USER_SCOPE_GROUP, SETTING_DEFAULT_PROJECT_TEMPLATE, ARTIFACT_TYPE,
  SETTING_DASHBOARD_DISPLAY_CONFIG, SETTING_INTAKE_TRIAGE_SIMILARITY_CONFIG,
  SETTING_NOTIFICATION_DISPLAY_CONFIG, SETTING_SP_DOCUMENT_CATEGORIES,
  SETTING_PMO_TEAM_FIELD, SETTING_TENANT_ID, SETTING_INTAKE_ROUTING_CONFIG,
  SETTING_PRIORITIZATION_WEIGHTS, SETTING_PRIORITIZATION_BUDGET_TIERS, SETTING_MIRA_SIGNAL_THRESHOLDS,
  SP_DOCUMENT_CATEGORIES,
  SETTING_SP_LIBRARY_BASE_URL, SP_LIBRARY_BASE_URL, SETTING_SP_DATA_SITE_URL,
  SETTING_TRACKING_LABELS, DEFAULT_TRACKING_LABELS,
  SETTING_ENVIRONMENT_LABEL, SETTING_ENVIRONMENT_BADGE_COLOR, ENV_BADGE_COLORS, type EnvBadgeColor,
  SETTING_BRAND_SIDEBAR_NAME, SETTING_BRAND_APP_TITLE, SETTING_BRAND_GREETING,
  DEFAULT_BRAND_SIDEBAR_NAME, DEFAULT_BRAND_APP_TITLE,
  SETTING_STANDARD_CAPACITY_HOURS,
} from '../../lib/constants';
import {
  usePmoTeamField, useEffectiveAdminRole, useConfig,
  type DashboardDisplayConfig,
  type IntakeTriageSimilarityConfig,
  type NotificationDisplayConfig,
  type RoutingDomain,
  type PrioritizationWeights,
  type BudgetTier,
  type MiraSignalThresholds,
  DEFAULT_DASHBOARD_DISPLAY, DEFAULT_INTAKE_TRIAGE_SIMILARITY, DEFAULT_NOTIFICATION_DISPLAY,
} from '../../providers/ConfigurationProvider';
import { scoreAgainstDomains } from '../../lib/intakeRoutingConfig';
import { DATA_SOURCE_SETTING_KEY } from '../../lib/taskSource';
import { PEOPLE_SOURCE_SETTING_KEY } from '../../lib/peopleSource';
import { FILE_SOURCE_SETTING_KEY } from '../../lib/fileSource';
import { defaultBadgeColorForLabel } from '../../lib/environmentConfig';
import { AdminPrincipalsSection } from '../../components/admin/AdminPrincipalsSection';
import { ConfigTransferSection } from '../../components/admin/ConfigTransferSection';
import { FS_CASCADE_SETTING_KEY } from '../../lib/scheduling/finishToStartCascade';
import { IntakeWorkflowConfigSection } from '../../components/admin/IntakeWorkflowEditor';
import { FeatureToggleSection } from '../../components/admin/FeatureToggleSection';
import { TableViewsSection } from '../../components/admin/TableViewsSection';
import { SidebarTeamsSection } from '../../components/admin/SidebarTeamsSection';
import { GlobalAnnouncementSection } from '../../components/admin/GlobalAnnouncementSection';
import { ResourcingSection } from '../../components/admin/ResourcingSection';
import { CollaborationModeSection } from '../../components/admin/CollaborationModeSection';
import { DemoModeSection } from '../../components/admin/DemoModeSection';
import { AllNotificationsSection } from '../../components/admin/AllNotificationsSection';
import { TeamMembershipSection } from '../../components/admin/TeamMembershipSection';
import { RoleAssignmentSection } from '../../components/admin/RoleAssignmentSection';
import { EtlBulkCatchupCard } from '../../components/admin/EtlBulkCatchupCard';
import { CFR_CATEGORY_LABELS, PROJECT_TEMPLATES, type TemplateTask } from '../../lib/projectTemplates';
import { toast } from '../../hooks/useToast';
import { useAdminAudit } from '../../hooks/useAdminAudit';
import { fetchPmoTeams } from '../../lib/pmoTeams';

interface Team {
  teamid: string;
  name: string;
  [key: string]: unknown;
}

function useTeams() {
  const pmoTeamField = usePmoTeamField();
  return useQuery<Team[]>({
    queryKey: ['teamsForSettings', pmoTeamField],
    queryFn: () => fetchPmoTeams<Team>(pmoTeamField, ['teamid', 'name']),
    staleTime: Infinity,
  });
}

const KNOWN_SETTINGS: Array<{
  key: string;
  label: string;
  description: string;
  type: 'text' | 'team-lookup' | 'template-lookup' | 'enum';
  options?: Array<{ value: string; label: string }>;
}> = [
  // ── Q1: General Data storage ────────────────────────────────────────────────
  {
    key: DATA_SOURCE_SETTING_KEY,
    label: 'Q1 — General Data Storage',
    description:
      'Controls where the app reads and writes projects, tasks, buckets, programs, and all related records. ' +
      '"Microsoft PSS" uses the msdyn tables via Project Scheduling Service (default). ' +
      '"Custom tables" reads and writes directly to the pmo_* tables; a manual end-of-day script refreshes Microsoft Project / Planner. ' +
      '"SharePoint lists" stores all custom-table records as SharePoint list items on the site you specify below — requires the site to be provisioned first via scripts/seed-sharepoint-data-lists.py.',
    type: 'enum',
    options: [
      { value: 'pss', label: 'Microsoft PSS (msdyn tables)' },
      { value: 'custom', label: 'Custom tables (pmo_) — Dataverse' },
      { value: 'sharepoint', label: 'SharePoint lists' },
    ],
  },
  // ── Q2: File / document storage ─────────────────────────────────────────────
  {
    key: FILE_SOURCE_SETTING_KEY,
    label: 'Q2 — File / Document Storage',
    description:
      'Where uploaded documents live for EVERY file surface — project, task, program, intake-request, user-feedback, and payer-inquiry attachments. ' +
      '"Dataverse" stores files as Notes (annotations) on each record. ' +
      '"SharePoint" stores them in the Nexus-PMO / AppDocuments library (per-record folder) and points every upload + download link there. ' +
      'Flip only after files have been reconciled to SharePoint.',
    type: 'enum',
    options: [
      { value: 'dataverse', label: 'Dataverse (annotations)' },
      { value: 'sharepoint', label: 'SharePoint (AppDocuments)' },
    ],
  },
  // ── Other settings ──────────────────────────────────────────────────────────
  {
    key: FS_CASCADE_SETTING_KEY,
    label: 'Auto-shift Dependent Tasks (Finish-to-Start Cascade)',
    description:
      'When enabled, moving a task\'s dates also shifts every task that depends on it by the same number of days, so a slip ripples through the chain automatically. Only applies to Finish-to-Start dependencies within the same project, and only on the Custom tables data source. A task marked "manually scheduled" keeps its own dates, but its dependents still shift. Circular dependencies are detected and the whole shift is cancelled rather than applied partially. Leave disabled to move each task independently.',
    type: 'enum',
    options: [
      { value: 'false', label: 'Disabled — move each task independently' },
      { value: 'true', label: 'Enabled — dependents shift automatically' },
    ],
  },
  {
    key: SETTING_STANDARD_CAPACITY_HOURS,
    label: 'Standard Monthly Capacity Hours',
    description:
      'Denominator used by the New Resource Model capacity views (project Resources sub-tab and the portfolio Capacity page) to compute each person\'s allocation percentage. Leave unset to use 160 — the same value the existing (Old Resource Model) capacity view already hardcodes, so an unset value changes nothing. Must be a positive integer.',
    type: 'text',
  },
  {
    key: SETTING_FALLBACK_TRIAGE_TEAM,
    label: 'Fallback Triage Team',
    description:
      'The PMO team that receives intake requests when routing confidence is too low to auto-assign. Select an owner team.',
    type: 'team-lookup',
  },
  {
    key: SETTING_USER_SCOPE_GROUP,
    label: 'User Scope — AAD Group Object ID',
    description:
      'Azure AD security group object ID used to restrict user selection fields (Project Manager, Executive Sponsor, Manager). The group must be synced as a Dataverse AAD group team. Uses the group object ID so it works across environments. Leave empty to show all active users.',
    type: 'text',
  },
  {
    key: SETTING_DEFAULT_PROJECT_TEMPLATE,
    label: 'Default Project Template',
    description:
      'System-wide default project template applied when no template is selected during project onboarding and no team-specific default exists. Select from active templates.',
    type: 'template-lookup',
  },
  {
    key: PEOPLE_SOURCE_SETTING_KEY,
    label: 'SAE Picker Source',
    description:
      'Where the Strategic Account Executive picker searches for people. "Dataverse users" searches the systemuser table (only provisioned users). "Office 365 directory" searches the whole Entra directory via the Office 365 Users connector — required to pick people who are not Dataverse users. If the connector is unavailable the picker falls back to Dataverse users.',
    type: 'enum',
    options: [
      { value: 'systemuser', label: 'Dataverse users (systemuser)' },
      { value: 'o365', label: 'Office 365 directory (Entra)' },
    ],
  },
];

// ── SharePoint data-site URL field (shown under Q1 when data_source = 'sharepoint') ──
// Stores the site URL used by the seeding script + provisioning docs.
// The connector binding is fixed at provisioning time — this value is for
// display and scripts only.
function SharePointDataSiteField({ existing }: { existing: AppSetting | undefined }) {
  const upsert = useUpsertSetting();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const current = existing?.pmo_value ?? '';

  function beginEdit() { setDraft(current); setEditing(true); }
  function cancel() { setEditing(false); setDraft(''); }
  async function save() {
    await upsert.mutateAsync({ key: SETTING_SP_DATA_SITE_URL, value: draft.trim() });
    toast.success('SharePoint data site URL saved');
    setEditing(false);
  }

  return (
    <div className="mt-1 rounded-md bg-muted/40 px-3 py-2 space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">SharePoint Site URL (general data)</p>
        {!editing && (
          <Button variant="outline" size="sm" className="h-6 px-2 text-xs shrink-0" onClick={beginEdit}>Edit</Button>
        )}
      </div>
      {!editing ? (
        <>
          <p className="text-sm text-foreground font-mono break-all">{current || '(not set)'}</p>
          <p className="text-xs text-muted-foreground">
            SharePoint site used as the general-data backend. Run{' '}
            <code className="font-mono">scripts/seed-sharepoint-data-lists.py --site &lt;url&gt; --commit</code>{' '}
            to seed the required lists before switching. The connector binding is
            fixed at provisioning time — changing this value does not repoint the
            connector; it is used by scripts and for documentation only.
          </p>
          <p className="text-xs text-muted-foreground/60 mt-0.5 font-mono">{SETTING_SP_DATA_SITE_URL}</p>
        </>
      ) : (
        <div className="space-y-2">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://contoso.sharepoint.com/sites/PMO" />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={upsert.isPending || draft.trim() === current}>
              {upsert.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={cancel}>Cancel</Button>
          </div>
          {upsert.isError && <p className="text-xs text-destructive">Failed to save. Please try again.</p>}
        </div>
      )}
    </div>
  );
}

// Editable SharePoint library base URL. Shown under Q2 (Document Storage) when
// file_source = sharepoint. Writes `pmo.sp_library_base_url` (consumed as
// config.spLibraryBaseUrl). NOTE: this drives the DISPLAYED library URL only;
// the actual upload/read connector target is bound at provisioning time (see
// docs/FIRST-TIME-SETUP.md). Empty value falls back to the compiled default.
function SharePointSiteField({ existing }: { existing: AppSetting | undefined }) {
  const { config } = useConfig();
  const upsert = useUpsertSetting();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const current = config.spLibraryBaseUrl || SP_LIBRARY_BASE_URL;
  const usingDefault = !(existing?.pmo_value ?? '').trim();

  function beginEdit() { setDraft(existing?.pmo_value ?? current); setEditing(true); }
  function cancel() { setEditing(false); setDraft(''); }
  async function save() {
    await upsert.mutateAsync({ key: SETTING_SP_LIBRARY_BASE_URL, value: draft.trim() });
    toast.success('SharePoint library URL saved');
    setEditing(false);
  }

  return (
    <div className="mt-1 rounded-md bg-muted/40 px-3 py-2 space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">SharePoint Library URL</p>
        {!editing && (
          <Button variant="outline" size="sm" className="h-6 px-2 text-xs shrink-0" onClick={beginEdit}>Edit</Button>
        )}
      </div>
      {!editing ? (
        <>
          <p className="text-sm text-foreground font-mono break-all">{current}</p>
          <p className="text-xs text-muted-foreground">
            {usingDefault ? 'Using the built-in default library URL. ' : 'Custom library URL set. '}
            This sets the library URL shown for documents. The actual upload/read
            connector target is bound at provisioning time (see docs/FIRST-TIME-SETUP.md);
            changing this value does not repoint the connector.
          </p>
          <p className="text-xs text-muted-foreground/60 mt-0.5 font-mono">{SETTING_SP_LIBRARY_BASE_URL}</p>
        </>
      ) : (
        <div className="space-y-2">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://contoso.sharepoint.com/sites/Site/Library" />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={upsert.isPending || draft.trim() === (existing?.pmo_value ?? '')}>
              {upsert.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={cancel}>Cancel</Button>
          </div>
          {upsert.isError && <p className="text-xs text-destructive">Failed to save. Please try again.</p>}
        </div>
      )}
    </div>
  );
}

interface SettingRowProps {
  def: (typeof KNOWN_SETTINGS)[number];
  existing: AppSetting | undefined;
  teams: Team[];
  templates: ProjectTemplate[];
  /** The pmo.sp_library_base_url row, passed so the SharePoint sub-field under
   *  Document Storage (Q2) can edit it independently of the file_source row. */
  spLibraryBaseUrlSetting?: AppSetting | undefined;
  /** The pmo.sp_data_site_url row, shown under Data Source (Q1) when sharepoint. */
  spDataSiteUrlSetting?: AppSetting | undefined;
}

function SettingRow({ def, existing, teams, templates, spLibraryBaseUrlSetting, spDataSiteUrlSetting }: SettingRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const upsert = useUpsertSetting();

  function beginEdit() {
    setDraft(existing?.pmo_value ?? (def.type === 'enum' ? def.options?.[0]?.value ?? '' : ''));
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setDraft('');
  }

  async function save() {
    await upsert.mutateAsync({ key: def.key, value: draft });
    toast.success(`${def.label} saved`);
    setEditing(false);
  }

  const currentLabel =
    def.type === 'team-lookup'
      ? teams.find((t) => t.teamid === existing?.pmo_value)?.name ?? existing?.pmo_value ?? '—'
      : def.type === 'template-lookup'
        ? templates.find((t) => t.pmo_projecttemplateid === existing?.pmo_value)?.pmo_name ?? existing?.pmo_value ?? '—'
        : def.type === 'enum'
          ? def.options?.find((o) => o.value === existing?.pmo_value)?.label ?? existing?.pmo_value ?? '—'
          : existing?.pmo_value ?? '—';

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{def.label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{def.description}</p>
          <p className="text-xs text-muted-foreground/60 mt-1 font-mono">{def.key}</p>
        </div>
        {!editing && (
          <Button variant="outline" size="sm" onClick={beginEdit} className="shrink-0">
            Edit
          </Button>
        )}
      </div>

      {!editing && (
        <div className="flex items-center gap-2 pt-1">
          {existing?.pmo_value ? (
            <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
          ) : (
            <X className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          )}
          <span className="text-sm text-foreground">{currentLabel}</span>
        </div>
      )}

      {/* Q1: show SP data-site URL input when data_source = 'sharepoint' */}
      {def.key === DATA_SOURCE_SETTING_KEY && existing?.pmo_value === 'sharepoint' && (
        <SharePointDataSiteField existing={spDataSiteUrlSetting} />
      )}
      {/* Q2: show SP library URL input when file_source = 'sharepoint' */}
      {def.key === FILE_SOURCE_SETTING_KEY && existing?.pmo_value === 'sharepoint' && (
        <SharePointSiteField existing={spLibraryBaseUrlSetting} />
      )}

      {editing && (
        <div className="pt-1 space-y-2">
          {def.type === 'team-lookup' ? (
            <select
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">— select a team —</option>
              {teams.map((t) => (
                <option key={t.teamid} value={t.teamid}>
                  {t.name}
                </option>
              ))}
            </select>
          ) : def.type === 'template-lookup' ? (
            <select
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">— no default template —</option>
              {templates.map((t) => (
                <option key={t.pmo_projecttemplateid} value={t.pmo_projecttemplateid}>
                  {t.pmo_name}
                </option>
              ))}
            </select>
          ) : def.type === 'enum' ? (
            <select
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {def.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Enter value..."
            />
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={save}
              disabled={upsert.isPending || draft === (existing?.pmo_value ?? '')}
            >
              {upsert.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1.5" />
              )}
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={cancel}>
              Cancel
            </Button>
          </div>
          {upsert.isError && (
            <p className="text-xs text-destructive">Failed to save. Please try again.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Template Management ─────────────────────────────────────────────────────

interface TemplateEditorProps {
  template?: ProjectTemplate;
  onClose: () => void;
}

function TemplateEditor({ template, onClose }: TemplateEditorProps) {
  const isNew = !template;
  const [name, setName] = useState(template?.pmo_name ?? '');
  const [description, setDescription] = useState(template?.pmo_description ?? '');
  const [category, setCategory] = useState<string>(
    template?.pmo_cfrcategory != null ? String(template.pmo_cfrcategory) : '',
  );
  const [taskPayload, setTaskPayload] = useState(
    template?.pmo_taskpayload ?? '[]',
  );

  const createMut = useCreateTemplate();
  const updateMut = useUpdateTemplate();

  const saving = createMut.isPending || updateMut.isPending;
  const mutError = createMut.isError || updateMut.isError;

  let parsedTasks: TemplateTask[] = [];
  let parseError = false;
  try {
    parsedTasks = JSON.parse(taskPayload);
    if (!Array.isArray(parsedTasks)) parseError = true;
  } catch {
    parseError = true;
  }

  async function handleSave() {
    if (!name.trim() || parseError) return;
    const payload = {
      pmo_name: name.trim(),
      pmo_description: description.trim() || undefined,
      pmo_cfrcategory: category ? Number(category) : undefined,
      pmo_taskpayload: taskPayload,
    };
    if (isNew) {
      await createMut.mutateAsync(payload);
      toast.success(`Template "${name.trim()}" created`);
    } else {
      await updateMut.mutateAsync({ id: template.pmo_projecttemplateid, payload });
      toast.success(`Template "${name.trim()}" updated`);
    }
    onClose();
  }

  function prefillFromCategory() {
    if (!category) return;
    const tasks = PROJECT_TEMPLATES[Number(category)];
    if (tasks) setTaskPayload(JSON.stringify(tasks, null, 2));
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-card p-4 space-y-3">
      <p className="text-sm font-medium text-foreground">
        {isNew ? 'New Template' : `Edit: ${template.pmo_name}`}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Name *</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">CFR Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Any category</option>
            {Object.entries(CFR_CATEGORY_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Description</label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-muted-foreground">
            Task Payload (JSON) — {parseError ? 'invalid JSON' : `${parsedTasks.length} tasks`}
          </label>
          {category && (
            <button
              type="button"
              onClick={prefillFromCategory}
              className="text-xs text-primary hover:underline"
            >
              Prefill from category default
            </button>
          )}
        </div>
        <textarea
          value={taskPayload}
          onChange={(e) => setTaskPayload(e.target.value)}
          rows={8}
          className={`w-full rounded-md border bg-background px-3 py-2 text-xs font-mono shadow-sm focus:outline-none focus:ring-1 focus:ring-ring ${parseError ? 'border-destructive' : 'border-input'}`}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving || !name.trim() || parseError}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
          {isNew ? 'Create' : 'Save'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
      </div>
      {mutError && <p className="text-xs text-destructive">Failed to save template.</p>}
    </div>
  );
}

function TemplateManagementSection() {
  const { data: templates = [], isPending } = useProjectTemplates();
  const deactivate = useDeactivateTemplate();
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);

  if (isPending) {
    return (
      <div className="flex items-center gap-2 py-4 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading templates...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Project Templates</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Define WBS task templates for project onboarding. Templates are applied during project creation to auto-generate initial tasks.
          </p>
        </div>
        {editingId !== 'new' && (
          <Button size="sm" variant="outline" onClick={() => setEditingId('new')}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Template
          </Button>
        )}
      </div>

      {editingId === 'new' && (
        <TemplateEditor onClose={() => setEditingId(null)} />
      )}

      {templates.length === 0 && editingId !== 'new' && (
        <p className="text-sm text-muted-foreground py-4">No templates defined. Create one to enable template-driven project onboarding.</p>
      )}

      {templates.map((t) => (
        <div key={t.pmo_projecttemplateid}>
          {editingId === t.pmo_projecttemplateid ? (
            <TemplateEditor template={t} onClose={() => setEditingId(null)} />
          ) : (
            <div className="rounded-lg border border-border bg-card p-4 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{t.pmo_name}</p>
                {t.pmo_description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{t.pmo_description}</p>
                )}
                <div className="flex items-center gap-3 mt-1.5">
                  {t.pmo_cfrcategory != null && (
                    <span className="text-xs text-muted-foreground">
                      {CFR_CATEGORY_LABELS[t.pmo_cfrcategory] ?? `Category ${t.pmo_cfrcategory}`}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {(() => { try { return `${JSON.parse(t.pmo_taskpayload).length} tasks`; } catch { return 'invalid payload'; } })()}
                  </span>
                  {t.pmo_issystemdefault && (
                    <span className="text-xs font-medium text-primary">System Default</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" onClick={() => setEditingId(t.pmo_projecttemplateid)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deactivate.mutate(t.pmo_projecttemplateid)}
                  disabled={deactivate.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const ARTIFACT_TYPE_LABELS: Record<number, string> = {
  [ARTIFACT_TYPE.BusinessCase]: 'Business Case',
  [ARTIFACT_TYPE.ProjectCharter]: 'Project Charter',
  [ARTIFACT_TYPE.RaciMatrix]: 'RACI Matrix',
  [ARTIFACT_TYPE.CommunicationPlan]: 'Communication Plan',
  [ARTIFACT_TYPE.RiskRegister]: 'Risk Register',
  [ARTIFACT_TYPE.SOW]: 'SOW',
  [ARTIFACT_TYPE.Budget]: 'Budget',
  [ARTIFACT_TYPE.CloseoutReport]: 'Closeout Report',
  [ARTIFACT_TYPE.LessonsLearned]: 'Lessons Learned',
  [ARTIFACT_TYPE.Other]: 'Other',
};

function ArtifactDefinitionSection() {
  const { data: artifacts = [], isPending } = useRequiredArtifacts();
  const createArtifact = useCreateRequiredArtifact();
  const updateArtifact = useUpdateRequiredArtifact();
  const deactivateArtifact = useDeactivateRequiredArtifact();
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteProjectCount, setDeleteProjectCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  const [artName, setArtName] = useState('');
  const [artType, setArtType] = useState(String(ARTIFACT_TYPE.BusinessCase));
  const [artCategory, setArtCategory] = useState<string>('');
  const [artRequired, setArtRequired] = useState(true);

  function resetForm() {
    setArtName(''); setArtType(String(ARTIFACT_TYPE.BusinessCase)); setArtCategory(''); setArtRequired(true);
  }

  function startEdit(a: { pmo_requiredartifactid: string; pmo_name: string; pmo_artifacttype: number; pmo_cfrcategory?: number; pmo_isrequired: boolean }) {
    setEditingId(a.pmo_requiredartifactid);
    setArtName(a.pmo_name);
    setArtType(String(a.pmo_artifacttype));
    setArtCategory(a.pmo_cfrcategory != null ? String(a.pmo_cfrcategory) : '');
    setArtRequired(a.pmo_isrequired);
    setAddOpen(false);
  }

  async function handleAdd() {
    if (!artName.trim()) return;
    await createArtifact.mutateAsync({
      pmo_name: artName.trim(),
      pmo_artifacttype: Number(artType),
      pmo_isrequired: artRequired,
      pmo_cfrcategory: artCategory ? Number(artCategory) : undefined,
    });
    toast.success(`Artifact "${artName.trim()}" created`);
    setAddOpen(false);
    resetForm();
  }

  async function handleUpdate() {
    if (!editingId || !artName.trim()) return;
    await updateArtifact.mutateAsync({
      id: editingId,
      payload: {
        pmo_name: artName.trim(),
        pmo_artifacttype: Number(artType),
        pmo_isrequired: artRequired,
        pmo_cfrcategory: artCategory ? Number(artCategory) : undefined,
      },
    });
    toast.success(`Artifact "${artName.trim()}" updated`);
    setEditingId(null);
    resetForm();
  }

  async function handleStartDelete(id: string, name: string) {
    setDeleteTarget({ id, name });
    setLoadingCount(true);
    try {
      const { countProjectsUsingArtifact } = await import('../../api/requiredArtifacts.api');
      const count = await countProjectsUsingArtifact(id);
      setDeleteProjectCount(count);
    } catch {
      setDeleteProjectCount(0);
    } finally {
      setLoadingCount(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    await deactivateArtifact.mutateAsync(deleteTarget.id);
    toast.success(`Artifact "${deleteTarget.name}" removed`);
    setDeleteTarget(null);
    setDeleteProjectCount(null);
  }

  if (isPending) {
    return (
      <div className="flex items-center gap-2 py-4 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading artifacts...</span>
      </div>
    );
  }

  const selectCls = "w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring";
  const isSaving = createArtifact.isPending || updateArtifact.isPending;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Required Artifacts</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Define which artifacts are required by project category. These are tracked on the Govern tab of each project.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => { resetForm(); setEditingId(null); setAddOpen(true); }}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add Artifact
        </Button>
      </div>

      {artifacts.length === 0 && !addOpen && (
        <p className="text-sm text-muted-foreground py-4">No required artifacts defined.</p>
      )}

      {artifacts.map((a) => (
        editingId === a.pmo_requiredartifactid ? null : (
          <div key={a.pmo_requiredartifactid} className="rounded-lg border border-border bg-card p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{a.pmo_name}</p>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                <span>{ARTIFACT_TYPE_LABELS[a.pmo_artifacttype] ?? 'Unknown'}</span>
                {a.pmo_cfrcategory != null && <span>{CFR_CATEGORY_LABELS[a.pmo_cfrcategory]}</span>}
                <span className={a.pmo_isrequired ? 'text-rose-500 font-medium' : 'text-muted-foreground'}>
                  {a.pmo_isrequired ? 'Required' : 'Optional'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => startEdit(a)} title="Edit">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => handleStartDelete(a.pmo_requiredartifactid, a.pmo_name)} title="Delete">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )
      ))}

      {/* Inline form for add or edit */}
      {(addOpen || editingId) && (
        <div className="rounded-lg border border-primary/30 bg-card p-4 space-y-3">
          <p className="text-sm font-medium text-foreground">{editingId ? 'Edit Artifact' : 'New Required Artifact'}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Name *</label>
              <Input value={artName} onChange={(e) => setArtName(e.target.value)} placeholder="Artifact name" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Type</label>
              <select value={artType} onChange={(e) => setArtType(e.target.value)} className={selectCls}>
                {Object.entries(ARTIFACT_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">CFR Category (blank = all)</label>
              <select value={artCategory} onChange={(e) => setArtCategory(e.target.value)} className={selectCls}>
                <option value="">All categories</option>
                {Object.entries(CFR_CATEGORY_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2 pb-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={artRequired} onChange={(e) => setArtRequired(e.target.checked)} className="rounded" />
                Required
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={editingId ? handleUpdate : handleAdd} disabled={isSaving || !artName.trim()}>
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              {editingId ? 'Save Changes' : 'Create'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setAddOpen(false); setEditingId(null); resetForm(); }}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog with project count warning */}
      {deleteTarget && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <p className="text-sm font-medium text-foreground">Delete &ldquo;{deleteTarget.name}&rdquo;?</p>
          {loadingCount ? (
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />Checking project usage...</p>
          ) : deleteProjectCount != null && deleteProjectCount > 0 ? (
            <p className="text-xs text-amber-600">
              {deleteProjectCount} project{deleteProjectCount > 1 ? 's' : ''} already {deleteProjectCount > 1 ? 'have' : 'has'} a status recorded for this artifact. Those status records will become orphaned and the artifact will no longer appear on their Govern tab.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">No projects are currently tracking this artifact.</p>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={handleConfirmDelete} disabled={deactivateArtifact.isPending || loadingCount}>
              {deactivateArtifact.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setDeleteTarget(null); setDeleteProjectCount(null); }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Phase 2: Operations sections ────────────────────────────────────────────

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
    </div>
  );
}

function MalformedWarning({ settingKey }: { settingKey: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <span>The saved value for <code className="font-mono">{settingKey}</code> is invalid. Default values are in use. Save this section to reset to defaults and fix.</span>
    </div>
  );
}

function DashboardDisplaySection() {
  const { data: settings = [] } = useAppSettings();
  const upsert = useUpsertSetting();
  const audit = useAdminAudit();
  const qc = useQueryClient();

  const existing = settings.find((s) => s.pmo_key === SETTING_DASHBOARD_DISPLAY_CONFIG);
  let parsed: DashboardDisplayConfig = { ...DEFAULT_DASHBOARD_DISPLAY };
  let malformed = false;
  if (existing?.pmo_value) {
    try { parsed = JSON.parse(existing.pmo_value); } catch { malformed = true; }
  }

  const [dueSoonDays, setDueSoonDays] = useState(String(parsed.dueSoonDays));
  const [needsAttentionLimit, setNeedsAttentionLimit] = useState(String(parsed.needsAttentionLimit));
  const [recentIntakeLimit, setRecentIntakeLimit] = useState(String(parsed.recentIntakeLimit));
  const [urgentDayThreshold, setUrgentDayThreshold] = useState(String(parsed.urgentDayThreshold));
  const [warningDayThreshold, setWarningDayThreshold] = useState(String(parsed.warningDayThreshold));
  const [saving, setSaving] = useState(false);

  function validateInt(v: string, min: number, max: number): boolean {
    const n = parseInt(v, 10);
    return !isNaN(n) && n >= min && n <= max;
  }

  const urgentNum = parseInt(urgentDayThreshold, 10);
  const warningNum = parseInt(warningDayThreshold, 10);
  const thresholdWarning = !isNaN(urgentNum) && !isNaN(warningNum) && urgentNum >= warningNum;

  const valid =
    validateInt(dueSoonDays, 1, 365) &&
    validateInt(needsAttentionLimit, 1, 50) &&
    validateInt(recentIntakeLimit, 1, 50) &&
    !isNaN(urgentNum) && urgentNum >= 0 &&
    !isNaN(warningNum) && warningNum > 0;

  async function handleSave() {
    if (!valid) return;
    setSaving(true);
    const newConfig: DashboardDisplayConfig = {
      dueSoonDays: parseInt(dueSoonDays, 10),
      needsAttentionLimit: parseInt(needsAttentionLimit, 10),
      recentIntakeLimit: parseInt(recentIntakeLimit, 10),
      urgentDayThreshold: urgentNum,
      warningDayThreshold: warningNum,
    };
    const newValue = JSON.stringify(newConfig);
    const oldValue = existing?.pmo_value ?? null;
    await upsert.mutateAsync({ key: SETTING_DASHBOARD_DISPLAY_CONFIG, value: newValue });
    audit({ settingKey: SETTING_DASHBOARD_DISPLAY_CONFIG, oldValue, newValue });
    qc.invalidateQueries({ queryKey: ['appSettings'] });
    toast.success('Dashboard display settings saved');
    setSaving(false);
  }

  const inputCls = "h-9 w-28 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <div className="space-y-4">
      <SectionHeader title="Dashboard Display Rules" description="Control what appears on the portfolio dashboard and how urgency is displayed." />
      {malformed && <MalformedWarning settingKey={SETTING_DASHBOARD_DISPLAY_CONFIG} />}
      <div className="grid grid-cols-2 gap-4 max-w-lg">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Due soon window (days)</label>
          <input className={inputCls} type="number" min={1} max={365} value={dueSoonDays} onChange={(e) => setDueSoonDays(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Needs Attention limit</label>
          <input className={inputCls} type="number" min={1} max={50} value={needsAttentionLimit} onChange={(e) => setNeedsAttentionLimit(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Recent Intake limit</label>
          <input className={inputCls} type="number" min={1} max={50} value={recentIntakeLimit} onChange={(e) => setRecentIntakeLimit(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Urgent day threshold (≤ N = red)</label>
          <input className={inputCls} type="number" min={0} value={urgentDayThreshold} onChange={(e) => setUrgentDayThreshold(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Warning day threshold (≤ N = amber)</label>
          <input className={inputCls} type="number" min={1} value={warningDayThreshold} onChange={(e) => setWarningDayThreshold(e.target.value)} />
        </div>
      </div>
      {thresholdWarning && (
        <p className="text-xs text-amber-600">Warning: urgent threshold should be less than warning threshold.</p>
      )}
      <Button size="sm" onClick={handleSave} disabled={saving || !valid}>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
        Save
      </Button>
    </div>
  );
}

function DocumentCategoriesSection() {
  const { data: settings = [] } = useAppSettings();
  const upsert = useUpsertSetting();
  const audit = useAdminAudit();
  const qc = useQueryClient();

  const existing = settings.find((s) => s.pmo_key === SETTING_SP_DOCUMENT_CATEGORIES);
  let current: string[] = [...SP_DOCUMENT_CATEGORIES];
  let malformed = false;
  if (existing?.pmo_value) {
    try { current = JSON.parse(existing.pmo_value); } catch { malformed = true; }
  }

  const [categories, setCategories] = useState<string[]>(current);
  const [newCat, setNewCat] = useState('');
  const [saving, setSaving] = useState(false);

  function addCategory() {
    const trimmed = newCat.trim();
    if (!trimmed || categories.includes(trimmed)) return;
    setCategories([...categories, trimmed]);
    setNewCat('');
  }

  function removeCategory(cat: string) {
    setCategories(categories.filter((c) => c !== cat));
  }

  async function handleSave() {
    if (categories.length === 0) return;
    setSaving(true);
    const newValue = JSON.stringify(categories);
    const oldValue = existing?.pmo_value ?? null;
    await upsert.mutateAsync({ key: SETTING_SP_DOCUMENT_CATEGORIES, value: newValue });
    audit({ settingKey: SETTING_SP_DOCUMENT_CATEGORIES, oldValue, newValue });
    qc.invalidateQueries({ queryKey: ['appSettings'] });
    toast.success('Document categories saved');
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      <SectionHeader title="Document Categories" description="Categories available when uploading SharePoint documents." />
      {malformed && <MalformedWarning settingKey={SETTING_SP_DOCUMENT_CATEGORIES} />}
      <div className="flex flex-wrap gap-2 max-w-2xl">
        {categories.map((cat) => (
          <span key={cat} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium text-foreground">
            {cat}
            <button type="button" onClick={() => removeCategory(cat)} className="text-muted-foreground hover:text-destructive transition-colors">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2 max-w-xs">
        <Input
          placeholder="New category..."
          value={newCat}
          onChange={(e) => setNewCat(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addCategory(); }}
          className="h-8 text-sm"
        />
        <Button size="sm" variant="outline" onClick={addCategory} disabled={!newCat.trim()}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <Button size="sm" onClick={handleSave} disabled={saving || categories.length === 0}>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
        Save
      </Button>
    </div>
  );
}

function TrackingLabelsSection() {
  const { data: settings = [] } = useAppSettings();
  const upsert = useUpsertSetting();
  const audit = useAdminAudit();
  const qc = useQueryClient();

  const existing = settings.find((s) => s.pmo_key === SETTING_TRACKING_LABELS);
  let current: string[] = [...DEFAULT_TRACKING_LABELS];
  let malformed = false;
  if (existing?.pmo_value) {
    try { current = JSON.parse(existing.pmo_value); } catch { malformed = true; }
  }

  const [labels, setLabels] = useState<string[]>(current);
  const [newLabel, setNewLabel] = useState('');
  const [saving, setSaving] = useState(false);

  function addLabel() {
    const trimmed = newLabel.trim();
    if (!trimmed || labels.includes(trimmed)) return;
    setLabels([...labels, trimmed]);
    setNewLabel('');
  }

  function removeLabel(label: string) {
    setLabels(labels.filter((l) => l !== label));
  }

  async function handleSave() {
    if (labels.length === 0) return;
    setSaving(true);
    const newValue = JSON.stringify(labels);
    const oldValue = existing?.pmo_value ?? null;
    await upsert.mutateAsync({ key: SETTING_TRACKING_LABELS, value: newValue });
    audit({ settingKey: SETTING_TRACKING_LABELS, oldValue, newValue });
    qc.invalidateQueries({ queryKey: ['appSettings'] });
    toast.success('Tracking labels saved');
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Tracking Labels"
        description="Labels users can apply to projects (and future entities) for personal cross-team tracking. Any authenticated user can tag any project regardless of team membership."
      />
      {malformed && <MalformedWarning settingKey={SETTING_TRACKING_LABELS} />}
      <div className="flex flex-wrap gap-2 max-w-2xl">
        {labels.map((label) => (
          <span key={label} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium text-foreground">
            {label}
            <button type="button" onClick={() => removeLabel(label)} className="text-muted-foreground hover:text-destructive transition-colors">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2 max-w-xs">
        <Input
          placeholder="New label..."
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addLabel(); }}
          className="h-8 text-sm"
        />
        <Button size="sm" variant="outline" onClick={addLabel} disabled={!newLabel.trim()}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <Button size="sm" onClick={handleSave} disabled={saving || labels.length === 0}>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
        Save
      </Button>
    </div>
  );
}

function IntakeTriageSimilaritySection() {
  const { data: settings = [] } = useAppSettings();
  const upsert = useUpsertSetting();
  const audit = useAdminAudit();
  const qc = useQueryClient();

  const existing = settings.find((s) => s.pmo_key === SETTING_INTAKE_TRIAGE_SIMILARITY_CONFIG);
  let parsed: IntakeTriageSimilarityConfig = { ...DEFAULT_INTAKE_TRIAGE_SIMILARITY };
  let malformed = false;
  if (existing?.pmo_value) {
    try { parsed = JSON.parse(existing.pmo_value); } catch { malformed = true; }
  }

  const [lookbackDays, setLookbackDays] = useState(String(parsed.lookbackDays));
  const [minScore, setMinScore] = useState(String(parsed.minScore));
  const [topN, setTopN] = useState(String(parsed.topN));
  const [saving, setSaving] = useState(false);

  const lookback = parseInt(lookbackDays, 10);
  const score = parseFloat(minScore);
  const top = parseInt(topN, 10);
  const valid =
    !isNaN(lookback) && lookback >= 1 && lookback <= 365 &&
    !isNaN(score) && score >= 0.01 && score <= 1.0 &&
    !isNaN(top) && top >= 1 && top <= 10;

  async function handleSave() {
    if (!valid) return;
    setSaving(true);
    const newConfig: IntakeTriageSimilarityConfig = { lookbackDays: lookback, minScore: score, topN: top };
    const newValue = JSON.stringify(newConfig);
    const oldValue = existing?.pmo_value ?? null;
    await upsert.mutateAsync({ key: SETTING_INTAKE_TRIAGE_SIMILARITY_CONFIG, value: newValue });
    audit({ settingKey: SETTING_INTAKE_TRIAGE_SIMILARITY_CONFIG, oldValue, newValue });
    qc.invalidateQueries({ queryKey: ['appSettings'] });
    toast.success('Intake triage similarity settings saved');
    setSaving(false);
  }

  const inputCls = "h-9 w-28 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <div className="space-y-4">
      <SectionHeader title="Intake Triage Similarity" description="Parameters for surfacing similar existing requests during intake submission." />
      {malformed && <MalformedWarning settingKey={SETTING_INTAKE_TRIAGE_SIMILARITY_CONFIG} />}
      <div className="grid grid-cols-3 gap-4 max-w-lg">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Lookback window (days)</label>
          <input className={inputCls} type="number" min={1} max={365} value={lookbackDays} onChange={(e) => setLookbackDays(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Min match score (0.01–1.0)</label>
          <input className={inputCls} type="number" min={0.01} max={1} step={0.01} value={minScore} onChange={(e) => setMinScore(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Max results shown (1–10)</label>
          <input className={inputCls} type="number" min={1} max={10} value={topN} onChange={(e) => setTopN(e.target.value)} />
        </div>
      </div>
      <Button size="sm" onClick={handleSave} disabled={saving || !valid}>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
        Save
      </Button>
    </div>
  );
}

function NotificationDisplaySection() {
  const { data: settings = [] } = useAppSettings();
  const upsert = useUpsertSetting();
  const audit = useAdminAudit();
  const qc = useQueryClient();

  const existing = settings.find((s) => s.pmo_key === SETTING_NOTIFICATION_DISPLAY_CONFIG);
  let parsed: NotificationDisplayConfig = { ...DEFAULT_NOTIFICATION_DISPLAY };
  let malformed = false;
  if (existing?.pmo_value) {
    try { parsed = JSON.parse(existing.pmo_value); } catch { malformed = true; }
  }

  const [pollSeconds, setPollSeconds] = useState(String(Math.round(parsed.pollIntervalMs / 1000)));
  const [saving, setSaving] = useState(false);

  const pollSec = parseInt(pollSeconds, 10);
  const valid = !isNaN(pollSec) && pollSec >= 30 && pollSec <= 300;

  async function handleSave() {
    if (!valid) return;
    setSaving(true);
    const newConfig: NotificationDisplayConfig = {
      ...parsed,
      pollIntervalMs: pollSec * 1000,
    };
    const newValue = JSON.stringify(newConfig);
    const oldValue = existing?.pmo_value ?? null;
    await upsert.mutateAsync({ key: SETTING_NOTIFICATION_DISPLAY_CONFIG, value: newValue });
    audit({ settingKey: SETTING_NOTIFICATION_DISPLAY_CONFIG, oldValue, newValue });
    qc.invalidateQueries({ queryKey: ['appSettings'] });
    toast.success('Notification display settings saved');
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      <SectionHeader title="Notification Display" description="Configure how often in-app notifications are polled from Dataverse." />
      {malformed && <MalformedWarning settingKey={SETTING_NOTIFICATION_DISPLAY_CONFIG} />}
      <div className="max-w-xs">
        <label className="text-xs text-muted-foreground block mb-1">Poll interval (seconds, 30–300)</label>
        <input
          className="h-9 w-36 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          type="number" min={30} max={300}
          value={pollSeconds}
          onChange={(e) => setPollSeconds(e.target.value)}
        />
        {!valid && pollSeconds && <p className="text-xs text-destructive mt-1">Must be between 30 and 300 seconds.</p>}
      </div>
      <Button size="sm" onClick={handleSave} disabled={saving || !valid}>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
        Save
      </Button>
    </div>
  );
}

// ─── Phase 3: Intake Routing Rules ───────────────────────────────────────────

function IntakeRoutingConfigSection() {
  const { data: teams = [] } = useTeams();
  const { data: settings = [] } = useAppSettings();
  const { config, malformedKeys } = useConfig();
  const upsert = useUpsertSetting();
  const audit = useAdminAudit();
  const qc = useQueryClient();

  const existing = settings.find((s) => s.pmo_key === SETTING_INTAKE_ROUTING_CONFIG);
  const isMalformed = malformedKeys.has(SETTING_INTAKE_ROUTING_CONFIG);

  const [domains, setDomains] = useState<RoutingDomain[]>(() => config.intakeRoutingConfig);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [newKw, setNewKw] = useState<Record<number, string>>({});
  const [testText, setTestText] = useState('');
  const [testResult, setTestResult] = useState<ReturnType<typeof scoreAgainstDomains>>(null);
  const [saving, setSaving] = useState(false);

  const isValid =
    domains.length > 0 &&
    domains.every(
      (d) => d.domainName.trim() && d.keywords.length > 0 && d.confidenceFloor >= 30 && d.confidenceFloor <= 90,
    );

  function updateDomain(idx: number, patch: Partial<RoutingDomain>) {
    setDomains((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }

  function addKeyword(idx: number) {
    const kw = (newKw[idx] ?? '').trim();
    if (!kw || domains[idx].keywords.includes(kw)) return;
    updateDomain(idx, { keywords: [...domains[idx].keywords, kw] });
    setNewKw((prev) => ({ ...prev, [idx]: '' }));
  }

  function removeKeyword(idx: number, kw: string) {
    updateDomain(idx, { keywords: domains[idx].keywords.filter((k) => k !== kw) });
  }

  function addDomain() {
    const newIdx = domains.length;
    setDomains((prev) => [...prev, { domainName: 'New Domain', teamId: '', keywords: [], confidenceFloor: 60 }]);
    setExpandedIdx(newIdx);
  }

  function removeDomain(idx: number) {
    setDomains((prev) => prev.filter((_, i) => i !== idx));
    setExpandedIdx((prev) => (prev === idx ? null : prev !== null && prev > idx ? prev - 1 : prev));
  }

  function runTest() {
    if (!testText.trim()) return;
    setTestResult(scoreAgainstDomains(testText, domains));
  }

  async function handleSave() {
    if (!isValid) return;
    setSaving(true);
    const newValue = JSON.stringify(domains);
    const oldValue = existing?.pmo_value ?? null;
    await upsert.mutateAsync({ key: SETTING_INTAKE_ROUTING_CONFIG, value: newValue });
    audit({ settingKey: SETTING_INTAKE_ROUTING_CONFIG, oldValue, newValue });
    qc.invalidateQueries({ queryKey: ['appSettings'] });
    toast.success('Intake routing configuration saved');
    setSaving(false);
  }

  const inputCls = 'h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeader
          title="Intake Routing Rules"
          description="Keyword-based routing domains that determine which PMO team receives each intake request."
        />
        <Button size="sm" variant="outline" onClick={addDomain}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />Add Domain
        </Button>
      </div>

      {isMalformed && <MalformedWarning settingKey={SETTING_INTAKE_ROUTING_CONFIG} />}

      {/* Test Route simulation */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Test Route (runs against current draft)</p>
        <div className="flex gap-2 items-start">
          <textarea
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            rows={2}
            placeholder="Paste a request description to test routing..."
            value={testText}
            onChange={(e) => { setTestText(e.target.value); setTestResult(null); }}
          />
          <Button size="sm" variant="outline" onClick={runTest} disabled={!testText.trim()}>
            Test
          </Button>
        </div>
        {testResult && (
          <div className={`rounded-md px-3 py-2 text-sm ${testResult.meetsFloor ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-amber-50 border border-amber-200 text-amber-800'}`}>
            <span className="font-semibold">{testResult.domainName}</span>
            {' — '}confidence {testResult.confidence}%
            {!testResult.meetsFloor && ' (below floor — would fall back to default team)'}
            {testResult.matched.length > 0 && (
              <span className="ml-2 text-xs opacity-75">
                Matched: {testResult.matched.slice(0, 5).join(', ')}{testResult.matched.length > 5 ? '…' : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Domain accordion list */}
      <div className="rounded-xl border border-border divide-y overflow-hidden">
        {domains.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No routing domains defined. Add one to enable keyword-based routing.
          </div>
        )}
        {domains.map((domain, idx) => {
          const isExpanded = expandedIdx === idx;
          return (
            <div key={idx}>
              <button
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
                onClick={() => setExpandedIdx(isExpanded ? null : idx)}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground">
                    {domain.domainName || 'Unnamed'}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {domain.keywords.length} keyword{domain.keywords.length !== 1 ? 's' : ''} · floor {domain.confidenceFloor}%
                  </span>
                </div>
                {!domain.teamId && (
                  <span className="text-xs text-amber-600 shrink-0">No team linked</span>
                )}
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
              </button>

              {isExpanded && (
                <div className="px-4 pb-5 pt-4 bg-muted/30 border-t space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Domain Name</label>
                      <Input
                        value={domain.domainName}
                        onChange={(e) => updateDomain(idx, { domainName: e.target.value })}
                        className="text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Confidence Floor (30–90%)</label>
                      <input
                        type="number" min={30} max={90}
                        value={domain.confidenceFloor}
                        onChange={(e) => updateDomain(idx, { confidenceFloor: parseInt(e.target.value, 10) || 60 })}
                        className={`w-24 ${inputCls}`}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Mapped PMO Team</label>
                    <select
                      value={domain.teamId}
                      onChange={(e) => updateDomain(idx, { teamId: e.target.value })}
                      className="w-full max-w-xs h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">— not linked —</option>
                      {teams.map((t) => (
                        <option key={t.teamid} value={t.teamid}>{t.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-muted-foreground block mb-2">
                      Keywords ({domain.keywords.length})
                      {domain.keywords.length === 0 && <span className="ml-1 text-destructive">— at least one required</span>}
                    </label>
                    <div className="flex flex-wrap gap-1.5 mb-2 min-h-8">
                      {domain.keywords.map((kw) => (
                        <span
                          key={kw}
                          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-xs font-medium text-foreground"
                        >
                          {kw}
                          <button
                            type="button"
                            onClick={() => removeKeyword(idx, kw)}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 max-w-xs">
                      <Input
                        placeholder="Add keyword..."
                        value={newKw[idx] ?? ''}
                        onChange={(e) => setNewKw((prev) => ({ ...prev, [idx]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(idx); } }}
                        className="h-8 text-sm"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => addKeyword(idx)}
                        disabled={!(newKw[idx] ?? '').trim()}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="pt-1 border-t border-border">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive h-7 px-2 text-xs"
                      onClick={() => removeDomain(idx)}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />Remove Domain
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={handleSave} disabled={saving || !isValid}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
          Save Routing Config
        </Button>
        {domains.length > 0 && !isValid && (
          <p className="text-xs text-destructive">
            Each domain needs a name, at least one keyword, and a confidence floor between 30–90.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Phase 4: Scoring & Signal Threshold sections ────────────────────────────

function ScoringConfigSection() {
  const { data: settings = [] } = useAppSettings();
  const upsert = useUpsertSetting();
  const audit = useAdminAudit();
  const qc = useQueryClient();
  const { config, malformedKeys } = useConfig();

  const [weights, setWeights] = useState<PrioritizationWeights>(() => config.prioritizationWeights);
  const [tiers, setTiers] = useState<BudgetTier[]>(() => config.prioritizationBudgetTiers);
  const [saving, setSaving] = useState(false);

  const weightSum = Object.values(weights).reduce((s, v) => s + (Number(v) || 0), 0);
  const weightsValid = weightSum === 100 && Object.values(weights).every((v) => Number(v) >= 0);
  const tiersValid = tiers.length > 0 && tiers.every((t) => t.minAmount >= 0 && t.score >= 0 && t.score <= 100);

  const weightsMalformed = malformedKeys.has(SETTING_PRIORITIZATION_WEIGHTS);
  const tiersMalformed = malformedKeys.has(SETTING_PRIORITIZATION_BUDGET_TIERS);

  function updateWeight(key: keyof PrioritizationWeights, val: string) {
    setWeights((prev) => ({ ...prev, [key]: Number(val) || 0 }));
  }

  function updateTier(idx: number, field: keyof BudgetTier, val: string) {
    setTiers((prev) => prev.map((t, i) => i === idx ? { ...t, [field]: Number(val) || 0 } : t));
  }

  function addTier() {
    setTiers((prev) => [...prev, { minAmount: 0, score: 0 }]);
  }

  function removeTier(idx: number) {
    setTiers((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (!weightsValid || !tiersValid) return;
    setSaving(true);
    try {
      const existingWeights = settings.find((s) => s.pmo_key === SETTING_PRIORITIZATION_WEIGHTS);
      const existingTiers = settings.find((s) => s.pmo_key === SETTING_PRIORITIZATION_BUDGET_TIERS);
      const newWeights = JSON.stringify(weights);
      const newTiers = JSON.stringify(tiers);
      await upsert.mutateAsync({ key: SETTING_PRIORITIZATION_WEIGHTS, value: newWeights });
      audit({ settingKey: SETTING_PRIORITIZATION_WEIGHTS, oldValue: existingWeights?.pmo_value ?? null, newValue: newWeights });
      await upsert.mutateAsync({ key: SETTING_PRIORITIZATION_BUDGET_TIERS, value: newTiers });
      audit({ settingKey: SETTING_PRIORITIZATION_BUDGET_TIERS, oldValue: existingTiers?.pmo_value ?? null, newValue: newTiers });
      qc.invalidateQueries({ queryKey: ['appSettings'] });
      toast.success('Scoring configuration saved');
    } catch {
      toast.error('Failed to save scoring configuration');
    } finally {
      setSaving(false);
    }
  }

  const WEIGHT_LABELS: Record<keyof PrioritizationWeights, string> = {
    strategicPriority: 'Strategic Priority',
    complexity: 'Complexity',
    health: 'Health',
    budget: 'Budget Scale',
    progress: 'Progress',
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Prioritization Scoring"
        description="Adjust the weights used to rank projects in the Analytics Prioritization view. Weights must sum to exactly 100."
      />
      {(weightsMalformed || tiersMalformed) && (
        <MalformedWarning settingKey={weightsMalformed ? SETTING_PRIORITIZATION_WEIGHTS : SETTING_PRIORITIZATION_BUDGET_TIERS} />
      )}

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Scoring Weights</p>
        {(Object.keys(WEIGHT_LABELS) as (keyof PrioritizationWeights)[]).map((key) => (
          <div key={key} className="flex items-center gap-3">
            <span className="text-sm w-36 shrink-0 text-foreground">{WEIGHT_LABELS[key]}</span>
            <Input
              type="number"
              min={0}
              max={100}
              value={weights[key]}
              onChange={(e) => updateWeight(key, e.target.value)}
              className="w-20 h-8 text-sm"
            />
            <span className="text-xs text-muted-foreground">pts</span>
          </div>
        ))}
        <div className={`text-xs font-semibold mt-1 ${weightSum === 100 ? 'text-green-600' : 'text-destructive'}`}>
          Total: {weightSum} / 100 {weightSum !== 100 && '— must equal 100 to save'}
        </div>
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Budget Tier Thresholds</p>
          <Button variant="ghost" size="sm" onClick={addTier} className="h-7 text-xs gap-1">
            <Plus className="h-3 w-3" />Add Tier
          </Button>
        </div>
        <div className="space-y-2">
          {tiers.map((tier, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-4">{idx + 1}.</span>
              <span className="text-xs text-muted-foreground w-10">≥ $</span>
              <Input
                type="number"
                min={0}
                value={tier.minAmount}
                onChange={(e) => updateTier(idx, 'minAmount', e.target.value)}
                className="w-28 h-8 text-sm"
                placeholder="Amount"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <Input
                type="number"
                min={0}
                max={100}
                value={tier.score}
                onChange={(e) => updateTier(idx, 'score', e.target.value)}
                className="w-20 h-8 text-sm"
                placeholder="Score"
              />
              <span className="text-xs text-muted-foreground">pts</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeTier(idx)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Tiers are evaluated highest-amount first. Projects below all thresholds score 20 pts.</p>
      </div>

      <div className="flex justify-end pt-2">
        <Button size="sm" onClick={handleSave} disabled={saving || !weightsValid || !tiersValid}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
          Save Scoring Config
        </Button>
      </div>
    </div>
  );
}

function SignalThresholdsSection() {
  const { data: settings = [] } = useAppSettings();
  const upsert = useUpsertSetting();
  const audit = useAdminAudit();
  const qc = useQueryClient();
  const { config, malformedKeys } = useConfig();

  const [thresholds, setThresholds] = useState<MiraSignalThresholds>(() => config.miraSignalThresholds);
  const [saving, setSaving] = useState(false);

  const isMalformed = malformedKeys.has(SETTING_MIRA_SIGNAL_THRESHOLDS);
  const countValid = thresholds.riskCountCritical > thresholds.riskCountWarn && thresholds.riskCountWarn >= 0;
  const scoreValid = thresholds.riskScoreCritical > thresholds.riskScoreWarn && thresholds.riskScoreWarn >= 0;
  const isValid = countValid && scoreValid;

  function update(key: keyof MiraSignalThresholds, val: string) {
    setThresholds((prev) => ({ ...prev, [key]: Number(val) || 0 }));
  }

  async function handleSave() {
    if (!isValid) return;
    setSaving(true);
    try {
      const existing = settings.find((s) => s.pmo_key === SETTING_MIRA_SIGNAL_THRESHOLDS);
      const newValue = JSON.stringify(thresholds);
      await upsert.mutateAsync({ key: SETTING_MIRA_SIGNAL_THRESHOLDS, value: newValue });
      audit({ settingKey: SETTING_MIRA_SIGNAL_THRESHOLDS, oldValue: existing?.pmo_value ?? null, newValue });
      qc.invalidateQueries({ queryKey: ['appSettings'] });
      toast.success('Signal thresholds saved');
    } catch {
      toast.error('Failed to save signal thresholds');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="AI Signal Thresholds"
        description="Configure when risk and issue counts are classified as warning or critical in Mira health signals and the risk score badge."
      />
      {isMalformed && <MalformedWarning settingKey={SETTING_MIRA_SIGNAL_THRESHOLDS} />}

      <div className="space-y-3">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Risk / Issue Count Bands</p>
          <div className="flex items-center gap-3">
            <span className="text-sm w-44 shrink-0 text-foreground">Warn threshold (≤ this)</span>
            <Input type="number" min={0} value={thresholds.riskCountWarn} onChange={(e) => update('riskCountWarn', e.target.value)} className="w-20 h-8 text-sm" />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm w-44 shrink-0 text-foreground">Critical threshold ({'>'} this)</span>
            <Input type="number" min={0} value={thresholds.riskCountCritical} onChange={(e) => update('riskCountCritical', e.target.value)} className="w-20 h-8 text-sm" />
          </div>
          {!countValid && <p className="text-xs text-destructive">Critical must be greater than warn.</p>}
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mira Risk Score Badge</p>
          <div className="flex items-center gap-3">
            <span className="text-sm w-44 shrink-0 text-foreground">Outline badge (≥ this)</span>
            <Input type="number" min={0} value={thresholds.riskScoreWarn} onChange={(e) => update('riskScoreWarn', e.target.value)} className="w-20 h-8 text-sm" />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm w-44 shrink-0 text-foreground">Destructive badge (≥ this)</span>
            <Input type="number" min={0} value={thresholds.riskScoreCritical} onChange={(e) => update('riskScoreCritical', e.target.value)} className="w-20 h-8 text-sm" />
          </div>
          {!scoreValid && <p className="text-xs text-destructive">Destructive threshold must be greater than outline threshold.</p>}
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button size="sm" onClick={handleSave} disabled={saving || !isValid}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
          Save Thresholds
        </Button>
      </div>
    </div>
  );
}

// ─── Phase 2: System tab sections ────────────────────────────────────────────

function EnvironmentSettingsSection() {
  const { data: settings = [] } = useAppSettings();
  const upsert = useUpsertSetting();
  const audit = useAdminAudit();
  const qc = useQueryClient();

  const teamFieldSetting = settings.find((s) => s.pmo_key === SETTING_PMO_TEAM_FIELD);
  const tenantIdSetting = settings.find((s) => s.pmo_key === SETTING_TENANT_ID);

  const [teamField, setTeamField] = useState(teamFieldSetting?.pmo_value ?? '');
  const [tenantId, setTenantId] = useState(tenantIdSetting?.pmo_value ?? '');
  const [savingTeam, setSavingTeam] = useState(false);
  const [savingTenant, setSavingTenant] = useState(false);
  const envLabelSetting = settings.find((s) => s.pmo_key === SETTING_ENVIRONMENT_LABEL);
  const badgeColorSetting = settings.find((s) => s.pmo_key === SETTING_ENVIRONMENT_BADGE_COLOR);
  const [envLabel, setEnvLabel] = useState(envLabelSetting?.pmo_value ?? '');
  const [badgeColor, setBadgeColor] = useState<EnvBadgeColor | ''>((badgeColorSetting?.pmo_value as EnvBadgeColor) ?? '');
  const [savingEnvLabel, setSavingEnvLabel] = useState(false);
  const [savingBadgeColor, setSavingBadgeColor] = useState(false);
  // Preview: explicit choice, else the label-derived default (matches runtime).
  const previewColor: EnvBadgeColor = badgeColor || defaultBadgeColorForLabel(envLabel || null);
  // Branding overrides.
  const brandNameSetting = settings.find((s) => s.pmo_key === SETTING_BRAND_SIDEBAR_NAME);
  const brandTitleSetting = settings.find((s) => s.pmo_key === SETTING_BRAND_APP_TITLE);
  const brandGreetingSetting = settings.find((s) => s.pmo_key === SETTING_BRAND_GREETING);
  const [brandName, setBrandName] = useState(brandNameSetting?.pmo_value ?? '');
  const [brandTitle, setBrandTitle] = useState(brandTitleSetting?.pmo_value ?? '');
  const [brandGreeting, setBrandGreeting] = useState(brandGreetingSetting?.pmo_value ?? '');
  const [savingBrandName, setSavingBrandName] = useState(false);
  const [savingBrandTitle, setSavingBrandTitle] = useState(false);
  const [savingBrandGreeting, setSavingBrandGreeting] = useState(false);

  async function saveBrand(key: string, value: string, oldValue: string | null, setSaving: (b: boolean) => void, label: string) {
    setSaving(true);
    await upsert.mutateAsync({ key, value });
    audit({ settingKey: key, oldValue, newValue: value });
    qc.invalidateQueries({ queryKey: ['appSettings'] });
    toast.success(`${label} saved`);
    setSaving(false);
  }

  async function saveTeamField() {
    if (!teamField.trim()) return;
    setSavingTeam(true);
    const newValue = teamField.trim();
    const oldValue = teamFieldSetting?.pmo_value ?? null;
    await upsert.mutateAsync({ key: SETTING_PMO_TEAM_FIELD, value: newValue });
    audit({ settingKey: SETTING_PMO_TEAM_FIELD, oldValue, newValue });
    qc.invalidateQueries({ queryKey: ['appSettings'] });
    toast.success('PMO team field saved');
    setSavingTeam(false);
  }

  async function saveTenantId() {
    if (!tenantId.trim()) return;
    setSavingTenant(true);
    const newValue = tenantId.trim();
    const oldValue = tenantIdSetting?.pmo_value ?? null;
    await upsert.mutateAsync({ key: SETTING_TENANT_ID, value: newValue });
    audit({ settingKey: SETTING_TENANT_ID, oldValue, newValue });
    qc.invalidateQueries({ queryKey: ['appSettings'] });
    toast.success('Tenant ID saved');
    setSavingTenant(false);
  }

  async function saveEnvLabel() {
    setSavingEnvLabel(true);
    const newValue = envLabel.trim();
    const oldValue = envLabelSetting?.pmo_value ?? null;
    await upsert.mutateAsync({ key: SETTING_ENVIRONMENT_LABEL, value: newValue });
    audit({ settingKey: SETTING_ENVIRONMENT_LABEL, oldValue, newValue });
    qc.invalidateQueries({ queryKey: ['appSettings'] });
    toast.success('Environment label saved');
    setSavingEnvLabel(false);
  }

  async function saveBadgeColor() {
    setSavingBadgeColor(true);
    const newValue = badgeColor;
    const oldValue = badgeColorSetting?.pmo_value ?? null;
    await upsert.mutateAsync({ key: SETTING_ENVIRONMENT_BADGE_COLOR, value: newValue });
    audit({ settingKey: SETTING_ENVIRONMENT_BADGE_COLOR, oldValue, newValue });
    qc.invalidateQueries({ queryKey: ['appSettings'] });
    toast.success('Badge color saved');
    setSavingBadgeColor(false);
  }

  return (
    <div className="space-y-6">
      <SectionHeader title="Environment Settings" description="Environment-specific values seeded at deployment. Changes take effect on next app load for all users." />
      <div className="space-y-4 max-w-lg">
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">PMO Team Flag Field</p>
            <p className="text-xs text-muted-foreground mt-0.5">Dataverse field name on the Team entity that marks PMO teams (e.g., <code className="font-mono">pmo_pmoteam</code>).</p>
          </div>
          <Input value={teamField} onChange={(e) => setTeamField(e.target.value)} placeholder="e.g. pmo_pmoteam" className="font-mono text-sm" />
          <Button size="sm" onClick={saveTeamField} disabled={savingTeam || !teamField.trim() || teamField.trim() === (teamFieldSetting?.pmo_value ?? '')}>
            {savingTeam ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save
          </Button>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">Microsoft Entra Tenant ID (identity directory for this Power Platform environment)</p>
            <p className="text-xs text-muted-foreground mt-0.5">The Microsoft Entra (Azure AD) directory tenant GUID that the Power Platform environment you are currently on belongs to — NOT the environment ID, and not related to hosting the app on Azure. Used to build Planner deep-links (<code className="font-mono">?tid=</code>). It is the same across DEV/UAT/PROD when they share one tenant. Find it in the Power Platform Admin Center (environment details) or Azure Portal → Entra ID → Overview.</p>
          </div>
          <Input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className="font-mono text-sm" />
          <Button size="sm" onClick={saveTenantId} disabled={savingTenant || !tenantId.trim() || tenantId.trim() === (tenantIdSetting?.pmo_value ?? '')}>
            {savingTenant ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save
          </Button>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">Brand Name (sidebar)</p>
            <p className="text-xs text-muted-foreground mt-0.5">Text shown next to the logo in the sidebar. Leave blank to use the default (<code className="font-mono">{DEFAULT_BRAND_SIDEBAR_NAME}</code>).</p>
          </div>
          <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="e.g. CFR PMO" className="text-sm" />
          <Button size="sm" onClick={() => saveBrand(SETTING_BRAND_SIDEBAR_NAME, brandName.trim(), brandNameSetting?.pmo_value ?? null, setSavingBrandName, "Brand Name (sidebar)")} disabled={savingBrandName || brandName.trim() === (brandNameSetting?.pmo_value ?? "")}>
            {savingBrandName ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save
          </Button>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">App Title (header banner)</p>
            <p className="text-xs text-muted-foreground mt-0.5">Title shown in the top header bar. Leave blank to use the default (<code className="font-mono">{DEFAULT_BRAND_APP_TITLE}</code>).</p>
          </div>
          <Input value={brandTitle} onChange={(e) => setBrandTitle(e.target.value)} placeholder="e.g. CFR Project Management" className="text-sm" />
          <Button size="sm" onClick={() => saveBrand(SETTING_BRAND_APP_TITLE, brandTitle.trim(), brandTitleSetting?.pmo_value ?? null, setSavingBrandTitle, "App Title (header banner)")} disabled={savingBrandTitle || brandTitle.trim() === (brandTitleSetting?.pmo_value ?? "")}>
            {savingBrandTitle ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save
          </Button>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">Greeting</p>
            <p className="text-xs text-muted-foreground mt-0.5">Fixed greeting shown in the header (e.g. “Welcome”). Leave blank for the automatic time-based greeting (Good morning / afternoon / evening).</p>
          </div>
          <Input value={brandGreeting} onChange={(e) => setBrandGreeting(e.target.value)} placeholder="Leave blank for time-based greeting" className="text-sm" />
          <Button size="sm" onClick={() => saveBrand(SETTING_BRAND_GREETING, brandGreeting.trim(), brandGreetingSetting?.pmo_value ?? null, setSavingBrandGreeting, "Greeting")} disabled={savingBrandGreeting || brandGreeting.trim() === (brandGreetingSetting?.pmo_value ?? "")}>
            {savingBrandGreeting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save
          </Button>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">Environment Badge — Label</p>
            <p className="text-xs text-muted-foreground mt-0.5">Text shown in the header badge for THIS environment (e.g. <code className="font-mono">DEV</code>, <code className="font-mono">UAT</code>, <code className="font-mono">PROD</code>, <code className="font-mono">SANDBOX</code>). Leave blank to auto-detect from the environment ID.</p>
          </div>
          <div className="flex items-center gap-3">
            <Input value={envLabel} onChange={(e) => setEnvLabel(e.target.value)} placeholder="e.g. DEV" className="font-mono text-sm max-w-[12rem]" />
            {envLabel && (<span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${ENV_BADGE_COLORS[previewColor]}`}>{envLabel}</span>)}
          </div>
          <Button size="sm" onClick={saveEnvLabel} disabled={savingEnvLabel || envLabel.trim() === (envLabelSetting?.pmo_value ?? '')}>
            {savingEnvLabel ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save
          </Button>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">Environment Badge — Color</p>
            <p className="text-xs text-muted-foreground mt-0.5">Color of the header badge. Leave as “Auto” to derive from the label (DEV=amber, UAT=sky, else emerald).</p>
          </div>
          <div className="flex items-center gap-3">
            <select value={badgeColor} onChange={(e) => setBadgeColor(e.target.value as EnvBadgeColor | '')} className="rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="">Auto (from label)</option>
              {(Object.keys(ENV_BADGE_COLORS) as EnvBadgeColor[]).map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${ENV_BADGE_COLORS[previewColor]}`}>{envLabel || 'PREVIEW'}</span>
          </div>
          <Button size="sm" onClick={saveBadgeColor} disabled={savingBadgeColor || badgeColor === ((badgeColorSetting?.pmo_value as EnvBadgeColor) ?? '')}>
            {savingBadgeColor ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function AdminSettingsPage() {
  const { data: settings = [], isPending, error } = useAppSettings();
  const { data: teams = [] } = useTeams();
  const { data: templates = [] } = useProjectTemplates();
  const adminRole = useEffectiveAdminRole();
  const isSystemAdmin = adminRole === 'system_admin';

  const settingMap = Object.fromEntries(settings.map((s) => [s.pmo_key, s]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Application Settings"
        subtitle="Administrator-managed configuration for the CFR PMO application"
      />
      <ErrorBanner error={error as Error | null} />

      <Tabs defaultValue="operations">
        <TabsList>
          <TabsTrigger value="operations">Operations</TabsTrigger>
          <TabsTrigger value="workflows">Architecture & Templates</TabsTrigger>
          {isSystemAdmin && <TabsTrigger value="system">System</TabsTrigger>}
        </TabsList>

        {/* ── Operations tab ──────────────────────────────────────────────── */}
        <TabsContent value="operations">
          <div className="space-y-8 pt-2">
            <GlobalAnnouncementSection />
            <div className="border-t border-border pt-6">
              <FeatureToggleSection />
            </div>
            <div className="border-t border-border pt-6">
              <SidebarTeamsSection />
            </div>
            <div className="border-t border-border pt-6">
              <DashboardDisplaySection />
            </div>
            <div className="border-t border-border pt-6">
              <DocumentCategoriesSection />
            </div>
            <div className="border-t border-border pt-6">
              <TrackingLabelsSection />
            </div>
            <div className="border-t border-border pt-6">
              <IntakeTriageSimilaritySection />
            </div>
            <div className="border-t border-border pt-6">
              <NotificationDisplaySection />
            </div>
            <div className="border-t border-border pt-6">
              <AllNotificationsSection />
            </div>
            <div className="border-t border-border pt-6">
              <TableViewsSection />
            </div>
            <div className="border-t border-border pt-6">
              <IntakeRoutingConfigSection />
            </div>
            <div className="border-t border-border pt-6">
              <ScoringConfigSection />
            </div>
            <div className="border-t border-border pt-6">
              <SignalThresholdsSection />
            </div>
            <div className="border-t border-border pt-6">
              <TeamMembershipSection />
            </div>
            <div className="border-t border-border pt-6">
              <RoleAssignmentSection />
            </div>
            <div className="border-t border-border pt-6">
              <DemoModeSection />
            </div>
            <div className="border-t border-border pt-6">
              <EtlBulkCatchupCard />
            </div>
          </div>
        </TabsContent>

        {/* ── Workflows & Templates tab ────────────────────────────────────── */}
        <TabsContent value="workflows">
          <div className="space-y-6 pt-2">
            {isPending ? (
              <div className="flex items-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading settings...</span>
              </div>
            ) : (
              <div className="space-y-3">
                {KNOWN_SETTINGS.map((def) => (
                  <SettingRow
                    key={def.key}
                    def={def}
                    existing={settingMap[def.key]}
                    teams={teams}
                    templates={templates}
                    spLibraryBaseUrlSetting={settingMap[SETTING_SP_LIBRARY_BASE_URL]}
                    spDataSiteUrlSetting={settingMap[SETTING_SP_DATA_SITE_URL]}
                  />
                ))}
              </div>
            )}
            <div className="border-t border-border pt-6">
              <IntakeWorkflowConfigSection />
            </div>
            <div className="border-t border-border pt-6">
              <TemplateManagementSection />
            </div>
            <div className="border-t border-border pt-6">
              <ArtifactDefinitionSection />
            </div>
            <div className="border-t border-border pt-6">
              <ResourcingSection />
            </div>
            <div className="border-t border-border pt-6">
              <CollaborationModeSection />
            </div>
          </div>
        </TabsContent>

        {/* ── System tab (System Admin only) ──────────────────────────────── */}
        {isSystemAdmin && (
          <TabsContent value="system">
            <div className="space-y-6 pt-2">
              <EnvironmentSettingsSection />
              <div className="border-t border-border pt-6">
                <AdminPrincipalsSection />
              </div>
              <div className="border-t border-border pt-6">
                <ConfigTransferSection />
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
