/**
 * TableViewsSection — Admin Settings editor for each table's ORG-WIDE Default
 * view: which columns appear, their order, and default widths.
 *
 * Column sources (three tiers):
 *   1. Shipped registry (TABLE_VIEW_REGISTRY) — hand-curated, always present.
 *      Virtual columns (isVirtual) are app-computed with no Dataverse attribute;
 *      they show a "Virtual" badge and are never flagged Removed by re-pull.
 *   2. Discovered catalog (columns.catalog.<table>[.<source>]) — written by
 *      Re-pull; new/removed columns flagged; survives deploys.
 *   3. Admin custom columns (columns.custom.<table>[.<source>]) — client-side
 *      computed formulas; show a "Custom" badge; deleted only manually; never
 *      touched by re-pull. Source-scoped for projects/programs.
 *
 * Column renames: each row has an inline header-rename Input. Overrides stored
 * in columns.labels.<table> (Record<colKey,label>), org-wide, survive re-pull.
 *
 * Catalog chunking: catalogs are split across multiple pmo_appsettings rows
 * (≤3500 chars each) so large PSS schemas don't hit the 4000-char cap.
 *
 * Ordering: drag by handle or type an Order number.
 */
import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { GripVertical, RotateCcw, Save, Loader2, RefreshCw, Plus, Trash2, Pencil, Search, X, Users, LayoutGrid, ArrowRightLeft } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '../ui/select';
import { useAppSettings, useUpsertSetting, useDeleteSetting } from '../../hooks/useAppSettings';
import { useColumnCatalog } from '../../hooks/useColumnCatalog';
import { useColumnLabels } from '../../hooks/useColumnLabels';
import { useColumnLookupAspect } from '../../hooks/useColumnLookupAspect';
import { aspectOptionsFor } from '../../lib/lookupResolver';
import { useAllPmoTeams } from '../../hooks/useAllPmoTeams';
import { listAllViewsForTable, updateUserViewConfig, deleteUserView } from '../../api/userViews.api';
import type { UserView } from '../../models/userView.model';
import {
  TABLE_VIEW_REGISTRY, orgDefaultViewKey, parseOrgDefaultView,
  columnCatalogChunkKey, columnCatalogChunkIndex, serializeColumnCatalogChunks,
  reassembleColumnCatalog, customColumnsKey, findDuplicateLabels, mergeColumns,
  type DiscoveredColumn, type DuplicateLabelGroup,
} from '../../lib/tableViewRegistry';
import {
  discoverAllTables, discoverColumns, resolveEntitySet,
  DISCOVERABLE_TABLE_KEYS, SOURCE_DEPENDENT_TABLE_KEYS,
} from '../../lib/columnDiscovery';
import {
  CUSTOM_COL_PREFIX, customColumnRuntimeKey, evaluateCustomColumn,
  extractFormulaFieldRefs,
  type CustomColumnFormula,
} from '../../lib/customColumns';
import { FORMULA_FUNCTION_NAMES, FORMULA_FUNCTIONS } from '../../lib/formulaFunctions';
import { useDataSource, type DataSource } from '../../lib/taskSource';
import { toast } from '../../hooks/useToast';
import { cn } from '../../lib/utils';

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
    </div>
  );
}

interface ColState {
  key: string;
  header: string;
  visible: boolean;
  width: number | '';
  isNew?: boolean;
  isRemoved?: boolean;
  isVirtual?: boolean;
  isCustom?: boolean;
  /** Real Dataverse attribute key when `key` is a normalizer alias. */
  realKey?: string;
  /** True when the backing attribute is a lookup (drives the Lookup badge). */
  isLookup?: boolean;
  /** Lookup target entity logical name(s). */
  targets?: string[];
}

async function saveChunkedCatalog(
  tableKey: string,
  discovered: DiscoveredColumn[],
  settings: ReadonlyArray<{ pmo_key: string | null; pmo_value: string | null; pmo_appsettingid: string }>,
  upsert: (args: { key: string; value: string }) => Promise<unknown>,
  del: (args: { key: string }) => Promise<unknown>,
  source?: DataSource,
): Promise<void> {
  const chunks = serializeColumnCatalogChunks(discovered);
  for (let i = 0; i < chunks.length; i++) {
    await upsert({ key: columnCatalogChunkKey(tableKey, i, source), value: chunks[i] });
  }
  const staleKeys = settings
    .filter((s) => {
      const idx = columnCatalogChunkIndex(s.pmo_key ?? '', tableKey, source);
      return idx != null && idx >= chunks.length;
    })
    .map((s) => s.pmo_key as string);
  for (const key of staleKeys) {
    await del({ key });
  }
}

// ─── Custom-column form — Excel-style formula bar ────────────────────────────
//
// Formula syntax: =IF([Budget]>100000,"Large",CONCATENATE([Status]," - ",[Name]))
// Field references: [Display Name]  (bracket-quoted; autocomplete on '[' key)
// Functions: autocomplete when typing a bare word that matches a known name

export type CustomColScope = 'personal' | 'team';

export function CustomColForm({
  availableKeys,
  allTeams,
  initialFormula,
  onSave,
  onCancel,
  /** 'admin' (default) shows the org-wide 'Visible to team' picker; 'user'
   *  shows a personal/team scope selector and returns the chosen scope. */
  variant = 'admin',
  /** In 'user' mode: called with the formula + chosen scope/team. */
  onSaveScoped,
  /** Initial scope for 'user' mode edit. */
  initialScope,
  initialScopeTeamId,
}: {
  availableKeys: { key: string; header: string }[];
  allTeams: { teamid: string; name: string }[];
  initialFormula?: CustomColumnFormula;
  onSave?: (formula: CustomColumnFormula) => void;
  onCancel: () => void;
  variant?: 'admin' | 'user';
  onSaveScoped?: (formula: CustomColumnFormula, scope: CustomColScope, teamId: string | null) => void;
  initialScope?: CustomColScope;
  initialScopeTeamId?: string | null;
}) {
  const TEAM_NONE = '__none__';
  const [label, setLabel] = useState(initialFormula?.label ?? '');
  const [teamId, setTeamId] = useState(initialFormula?.teamId ?? TEAM_NONE);
  // User-mode scope: personal (only me) or team (a team I belong to).
  const [userScope, setUserScope] = useState<CustomColScope>(initialScope ?? 'personal');
  const [userScopeTeam, setUserScopeTeam] = useState<string>(initialScopeTeamId ?? (allTeams[0]?.teamid ?? ''));
  const [formulaText, setFormulaText] = useState(initialFormula?.formula ?? '=');
  const [fieldSuggest, setFieldSuggest] = useState<{ items: { key: string; header: string }[]; query: string } | null>(null);
  const [fnSuggest, setFnSuggest] = useState<string[]>([]);
  const [previewValue, setPreviewValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const isEditing = !!initialFormula;

  // Build label→colKey index for live preview
  const fieldIndex = useMemo(() => {
    const idx: Record<string, string> = {};
    for (const k of availableKeys) idx[k.header.toLowerCase()] = k.key;
    return idx;
  }, [availableKeys]);

  // First data row for live preview (synthetic row with placeholder values)
  const sampleRow = useMemo<Record<string, unknown>>(() => {
    const row: Record<string, unknown> = {};
    for (const k of availableKeys) {
      row[k.key] = 'Sample';
      row[k.key + '@OData.Community.Display.V1.FormattedValue'] = k.header + ' value';
    }
    return row;
  }, [availableKeys]);

  // Live preview
  useEffect(() => {
    if (!formulaText || formulaText === '=') { setPreviewValue(''); return; }
    const formula: CustomColumnFormula = { id: 'preview', label: '', formula: formulaText };
    const v = evaluateCustomColumn(sampleRow, formula, fieldIndex);
    setPreviewValue(v);
  }, [formulaText, sampleRow, fieldIndex]);

  function handleFormulaChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setFormulaText(val);
    detectSuggestions(val, e.target.selectionStart ?? val.length);
  }

  function detectSuggestions(val: string, cursor: number) {
    const before = val.slice(0, cursor);
    // Field autocomplete: after '['
    const bracketMatch = /\[([^\]]*)$/.exec(before);
    if (bracketMatch) {
      const query = bracketMatch[1].toLowerCase();
      const items = availableKeys.filter((k) => k.header.toLowerCase().includes(query)).slice(0, 10);
      setFieldSuggest({ items, query });
      setFnSuggest([]);
      return;
    }
    setFieldSuggest(null);
    // Function autocomplete: bare word at cursor
    const wordMatch = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(before);
    if (wordMatch) {
      const q = wordMatch[1].toUpperCase();
      if (q.length >= 2) {
        const matches = FORMULA_FUNCTION_NAMES.filter((n) => n.startsWith(q)).slice(0, 8);
        setFnSuggest(matches);
        return;
      }
    }
    setFnSuggest([]);
  }

  function insertField(k: { key: string; header: string }) {
    const el = inputRef.current;
    if (!el) return;
    const cursor = el.selectionStart ?? formulaText.length;
    const before = formulaText.slice(0, cursor);
    const after = formulaText.slice(cursor);
    // Replace from the opening '[' we know is there
    const bracketIdx = before.lastIndexOf('[');
    const newBefore = bracketIdx >= 0 ? before.slice(0, bracketIdx) : before;
    const insert = `[${k.header}]`;
    const next = newBefore + insert + after;
    setFormulaText(next);
    setFieldSuggest(null);
    const newPos = newBefore.length + insert.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(newPos, newPos);
    });
  }

  function insertFunction(name: string) {
    const el = inputRef.current;
    if (!el) return;
    const cursor = el.selectionStart ?? formulaText.length;
    const before = formulaText.slice(0, cursor);
    const after = formulaText.slice(cursor);
    const wordMatch = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(before);
    const stripped = wordMatch ? before.slice(0, before.length - wordMatch[1].length) : before;
    const insert = `${name}(`;
    const next = stripped + insert + after;
    setFormulaText(next);
    setFnSuggest([]);
    const newPos = stripped.length + insert.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(newPos, newPos);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (fieldSuggest && fieldSuggest.items.length > 0) {
      if (e.key === 'Escape') { e.preventDefault(); setFieldSuggest(null); return; }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        insertField(fieldSuggest.items[0]);
        return;
      }
    }
    if (fnSuggest.length > 0) {
      if (e.key === 'Escape') { e.preventDefault(); setFnSuggest([]); return; }
      if (e.key === 'Tab') { e.preventDefault(); insertFunction(fnSuggest[0]); return; }
    }
  }

  function handleSave() {
    if (!label.trim()) { toast.error('Column name is required.'); return; }
    if (!formulaText || formulaText === '=') { toast.error('Formula is required.'); return; }
    const built: CustomColumnFormula = {
      id: initialFormula?.id ?? crypto.randomUUID(),
      label: label.trim(),
      formula: formulaText.startsWith('=') ? formulaText : `=${formulaText}`,
    };
    if (variant === 'user') {
      if (userScope === 'team' && !userScopeTeam) { toast.error('Pick a team for a team-scoped column.'); return; }
      onSaveScoped?.(built, userScope, userScope === 'team' ? userScopeTeam : null);
      return;
    }
    built.teamId = (teamId === TEAM_NONE || !teamId) ? undefined : teamId;
    onSave?.(built);
  }

  const isError = previewValue.startsWith('#ERROR') || previewValue === '#DIV/0!';

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit custom column' : 'New custom column'}</DialogTitle>
          <DialogDescription>
            Write an Excel-style formula. Use <code>[Field Name]</code> for column references,
            e.g. <code>=IF([Budget]&gt;100000,"High","Low")</code>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Column label *</label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Budget Category" className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                {variant === 'user' ? 'Who can see this' : 'Visible to team'}
              </label>
              {variant === 'user' ? (
                <div className="flex gap-2">
                  <Select value={userScope} onValueChange={(v) => setUserScope(v as CustomColScope)}>
                    <SelectTrigger className="h-8 text-sm w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="personal">Just me</SelectItem>
                      <SelectItem value="team">My team</SelectItem>
                    </SelectContent>
                  </Select>
                  {userScope === 'team' && (
                    <Select value={userScopeTeam} onValueChange={setUserScopeTeam}>
                      <SelectTrigger className="h-8 text-sm flex-1"><SelectValue placeholder="Pick team" /></SelectTrigger>
                      <SelectContent>
                        {allTeams.map((t) => <SelectItem key={t.teamid} value={t.teamid}>{t.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              ) : (
                <Select value={teamId} onValueChange={setTeamId}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All users" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">All users</SelectItem>
                    {allTeams.map((t) => <SelectItem key={t.teamid} value={t.teamid}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {/* Formula bar */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Formula *</label>
            <div className="flex items-center gap-1.5 rounded-md border border-input bg-input focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0 focus-within:border-ring/60 px-2">
              <span className="text-sm font-mono font-semibold text-muted-foreground select-none">fx</span>
              <input
                ref={inputRef}
                value={formulaText}
                onChange={handleFormulaChange}
                onKeyDown={handleKeyDown}
                onBlur={() => { setTimeout(() => { setFieldSuggest(null); setFnSuggest([]); }, 150); }}
                placeholder="=CONCATENATE([Status],&quot; — &quot;,[Name])"
                className="flex-1 bg-transparent text-sm font-mono py-1.5 outline-none placeholder:text-muted-foreground/50"
                spellCheck={false}
                autoComplete="off"
              />
            </div>

            {/* Field autocomplete dropdown */}
            {fieldSuggest && fieldSuggest.items.length > 0 && (
              <div className="rounded-md border bg-popover shadow-md z-50 max-h-48 overflow-y-auto">
                {fieldSuggest.items.map((k) => (
                  <button
                    key={k.key}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); insertField(k); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/60 text-left"
                  >
                    <span className="font-mono text-xs text-primary">[{k.header}]</span>
                    <span className="text-xs text-muted-foreground truncate">{k.key}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Function autocomplete dropdown */}
            {fnSuggest.length > 0 && (
              <div className="rounded-md border bg-popover shadow-md z-50">
                {fnSuggest.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); insertFunction(name); }}
                    className="w-full flex items-start gap-3 px-3 py-1.5 text-sm hover:bg-muted/60 text-left"
                  >
                    <span className="font-mono text-xs font-semibold text-primary mt-0.5 shrink-0">{name}</span>
                    <span className="text-xs text-muted-foreground">{FORMULA_FUNCTIONS[name]?.signature ?? ''}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Live preview */}
            <div className={cn(
              'flex items-center gap-2 text-xs px-2 py-1 rounded-sm',
              isError ? 'text-destructive bg-destructive/5' : 'text-muted-foreground bg-muted/30',
            )}>
              <span className="font-medium shrink-0">Preview:</span>
              <span className="font-mono truncate" title={previewValue}>
                {previewValue === '' ? '(enter a formula above)' : (isError ? previewValue : `"${previewValue}"`)}
              </span>
            </div>

            {/* Quick-insert field chips */}
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground">Insert field:</p>
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                {availableKeys.slice(0, 20).map((k) => (
                  <button
                    key={k.key}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); insertFieldByName(k, inputRef, formulaText, setFormulaText); }}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground font-mono truncate max-w-[160px]"
                    title={k.key}
                  >
                    [{k.header}]
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Function reference card */}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground font-medium select-none">Function reference</summary>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 max-h-48 overflow-y-auto pr-1">
              {Object.entries(FORMULA_FUNCTIONS).sort(([a],[b])=>a.localeCompare(b)).map(([name, meta]) => (
                <div key={name} className="flex gap-2">
                  <span className="font-mono font-semibold text-primary shrink-0">{name}</span>
                  <span className="text-muted-foreground truncate">{meta.description}</span>
                </div>
              ))}
            </div>
          </details>

        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
          <Button type="button" size="sm" onClick={handleSave}>
            {isEditing ? 'Save changes' : 'Add column'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Insert [Field Name] at the current cursor position (used by quick-insert chips). */
function insertFieldByName(
  k: { key: string; header: string },
  inputRef: React.RefObject<HTMLInputElement | null>,
  formulaText: string,
  setFormulaText: (v: string) => void,
) {
  const el = inputRef.current;
  const cursor = el ? (el.selectionStart ?? formulaText.length) : formulaText.length;
  const before = formulaText.slice(0, cursor);
  const after = formulaText.slice(cursor);
  const insert = `[${k.header}]`;
  const next = before + insert + after;
  setFormulaText(next);
  const newPos = before.length + insert.length;
  requestAnimationFrame(() => {
    if (!el) return;
    el.focus();
    el.setSelectionRange(newPos, newPos);
  });
}

// ─── Delete-confirm dialog for custom columns ───────────────────────────────

function DeleteCustomColDialog({
  columnLabel,
  onCancel,
  onConfirm,
}: {
  columnLabel: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const match = typed.trim() === columnLabel.trim();

  async function handleConfirm() {
    if (!match) return;
    setDeleting(true);
    try { await onConfirm(); } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove custom column');
    } finally { setDeleting(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete custom column</DialogTitle>
          <DialogDescription>
            This permanently removes the column and its formula. To confirm, type the column name{' '}
            <span className="font-semibold text-foreground">{columnLabel}</span> below.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={columnLabel}
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter' && match) void handleConfirm(); }}
        />
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={deleting}>Cancel</Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={!match || deleting}
            className="bg-rose-600 hover:bg-rose-700 text-white"
          >
            {deleting ? 'Deleting…' : 'Delete column'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function TableViewsSection() {
  const { data: settings = [] } = useAppSettings();
  const upsert = useUpsertSetting();
  const del = useDeleteSetting();
  const dataSource = useDataSource();
  const [tableKey, setTableKey] = useState<string>(TABLE_VIEW_REGISTRY[0]?.tableKey ?? '');
  const [saving, setSaving] = useState(false);
  const [repull, setRepull] = useState<{ label: string; done: number; total: number } | null>(null);

  // Section tab: 'default' = Org Default view editor, 'user-views' = admin browser of all user custom views.
  const [activeTab, setActiveTab] = useState<'default' | 'user-views'>('default');

  // Post-repull advisory state.
  // duplicateGroups: columns sharing a display label after the pull (amber panel).
  // deletedImpact: columns that vanished from the new catalog but are actively
  //   used in the org Default view, custom-column formulas, or label overrides.
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateLabelGroup[]>([]);
  interface DeletedImpactItem { key: string; inDefaultView: boolean; inCustomFormulas: boolean; inLabelOverrides: boolean; }
  const [deletedImpact, setDeletedImpact] = useState<DeletedImpactItem[]>([]);
  // Replacement picker: deletedKey → chosen replacement key.
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [applyingReplacement, setApplyingReplacement] = useState<string | null>(null);

  // User Views tab state.
  const [allUserViews, setAllUserViews] = useState<UserView[] | null>(null);
  const [loadingUserViews, setLoadingUserViews] = useState(false);
  const [deletingViewId, setDeletingViewId] = useState<string | null>(null);
  const [editingViewId, setEditingViewId] = useState<string | null>(null);

  // Custom column form state:
  //   null        = form closed
  //   'new'       = adding a new column
  //   formula id  = editing that formula
  const [customFormMode, setCustomFormMode] = useState<null | 'new' | string>(null);
  const [deletingCustomCol, setDeletingCustomCol] = useState<{ id: string; label: string } | null>(null);

  const allTeams = useAllPmoTeams({ enabled: true }) ?? [];

  const table = useMemo(
    () => TABLE_VIEW_REGISTRY.find((t) => t.tableKey === tableKey),
    [tableKey],
  );

  const catalogSource = SOURCE_DEPENDENT_TABLE_KEYS.has(tableKey) ? dataSource : undefined;
  const { columns: mergedColumns, hasCatalog, customColumns } = useColumnCatalog(tableKey, catalogSource);
  // When the catalog was last re-pulled: the base catalog chunk row's modifiedon.
  const catalogLoadedAt = (() => {
    const baseKey = columnCatalogChunkKey(tableKey, 0, catalogSource);
    const row = settings.find((st) => st.pmo_key === baseKey);
    return row?.modifiedon ? new Date(row.modifiedon) : null;
  })();
  const { overrides: labelOverrides, setLabel } = useColumnLabels(tableKey);
  const { aspects: lookupAspects, setAspect: setLookupAspect } = useColumnLookupAspect(tableKey);

  const savedRaw = settings.find((s) => (s.pmo_key ?? '') === orgDefaultViewKey(tableKey))?.pmo_value ?? undefined;

  const [draft, setDraft] = useState<ColState[] | null>(null);
  const derived = useMemo<ColState[]>(() => {
    if (!table) return [];
    const cfg = parseOrgDefaultView(savedRaw);
    const widths = cfg.widths ?? {};

    // Build full column list: merged (shipped + discovered) + custom columns.
    const allCols: Array<{ key: string; header: string; isNew?: boolean; isRemoved?: boolean; isVirtual?: boolean; isCustom?: boolean; realKey?: string; isLookup?: boolean; targets?: string[] }> = [
      ...mergedColumns.map((c) => ({ ...c })),
      ...customColumns.map((f) => ({
        key: customColumnRuntimeKey(f.id),
        header: f.label,
        isCustom: true as const,
      })),
    ];

    const byKey = new Map(allCols.map((c) => [c.key, c]));
    const allKeys = allCols.map((c) => c.key);
    const orderedKeys = cfg.columns && cfg.columns.length
      ? [...cfg.columns.filter((k) => byKey.has(k)), ...allKeys.filter((k) => !cfg.columns!.includes(k))]
      : allKeys;
    const visibleSet = cfg.columns && cfg.columns.length ? new Set(cfg.columns) : new Set(allKeys);

    return orderedKeys.map((k) => {
      const col = byKey.get(k)!;
      return {
        key: k,
        // Apply label override if present, otherwise use the column's own header.
        header: labelOverrides[k] ?? col.header,
        // Newly-discovered columns (isNew) default to UNSELECTED so a re-pull /
        // "re-pull all" never silently adds columns to the visible view — the
        // admin opts them in explicitly. When a saved org-default view exists we
        // honor it exactly; otherwise fall back to shipped defaults minus new.
        visible: (cfg.columns && cfg.columns.length)
          ? visibleSet.has(k)
          : (visibleSet.has(k) && !col.isNew),
        width: widths[k] ?? '',
        isNew: col.isNew,
        isRemoved: col.isRemoved,
        isVirtual: col.isVirtual,
        isCustom: col.isCustom,
        realKey: col.realKey,
        isLookup: (col as { isLookup?: boolean }).isLookup,
        targets: (col as { targets?: string[] }).targets,
      };
    });
  }, [table, savedRaw, mergedColumns, customColumns, labelOverrides]);

  const cols = draft ?? derived;

  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  // Track which row is in rename-edit mode (by key).
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  function update(next: ColState[]) { setDraft(next); }
  // Toggling visibility also REORDERS so the visible columns always stay grouped
  // at the top in order. Checking a column moves it to the end of the visible
  // block (its Order # becomes lastVisible+1); unchecking drops it just below the
  // visible block. Order == array index, so we splice to the right spot.
  function toggle(i: number) {
    const n = cols.slice();
    const nowVisible = !n[i].visible;
    const [moved] = n.splice(i, 1);
    moved.visible = nowVisible;
    // Count visible columns remaining after removal — the visible block occupies
    // indices [0 .. visibleCount-1]. Insert at visibleCount so a newly-visible
    // column lands at the end of that block, and a newly-hidden one at its start.
    const visibleCount = n.filter((c) => c.visible).length;
    n.splice(visibleCount, 0, moved);
    update(n);
  }
  function setWidth(i: number, v: string) {
    const num = v === '' ? '' : Math.max(40, Number(v) || 0);
    const n = cols.slice(); n[i] = { ...n[i], width: num }; update(n);
  }

  function setOrder(from: number, value: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const to = Math.min(cols.length, Math.max(1, Math.round(parsed))) - 1;
    if (to === from) return;
    const n = cols.slice();
    const [moved] = n.splice(from, 1);
    n.splice(to, 0, moved);
    update(n);
  }

  function reorderByKey(fromKey: string, toKey: string) {
    if (!fromKey || fromKey === toKey) return;
    const n = cols.slice();
    const from = n.findIndex((c) => c.key === fromKey);
    const to = n.findIndex((c) => c.key === toKey);
    if (from < 0 || to < 0) return;
    const [moved] = n.splice(from, 1);
    n.splice(to, 0, moved);
    update(n);
  }

  function startRename(key: string, currentHeader: string) {
    setRenamingKey(key);
    setRenameValue(currentHeader);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  }

  async function commitRename(key: string) {
    setRenamingKey(null);
    const trimmed = renameValue.trim();
    // Find the original (non-overridden) header for this key.
    const original = mergedColumns.find((c) => c.key === key)?.header
      ?? customColumns.find((f) => customColumnRuntimeKey(f.id) === key)?.label
      ?? '';
    // Only write if it's actually different from the original; clear override if reset to original.
    const effectiveLabel = trimmed === original || trimmed === '' ? '' : trimmed;
    try {
      await setLabel(key, effectiveLabel);
      // Also update draft header so the list reflects immediately.
      if (draft) {
        setDraft(draft.map((c) => c.key === key ? { ...c, header: effectiveLabel || original } : c));
      }
    } catch {
      toast.error('Failed to save label override');
    }
  }

  async function handleSave() {
    if (!table) return;
    // Persist visible columns — exclude Removed (metadata gone), keep Virtual and Custom.
    const visible = cols.filter((c) => c.visible && !c.isRemoved);
    if (visible.length === 0) { toast.error('Select at least one column.'); return; }
    const widths: Record<string, number> = {};
    for (const c of cols) if (typeof c.width === 'number' && c.width > 0 && !c.isRemoved) widths[c.key] = c.width;
    const config = { columns: visible.map((c) => c.key), widths };
    setSaving(true);
    try {
      await upsert.mutateAsync({ key: orgDefaultViewKey(table.tableKey), value: JSON.stringify(config) });
      toast.success(`Saved default view for ${table.label}`);
      setDraft(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save default view');
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!table) return;
    setSaving(true);
    try {
      await upsert.mutateAsync({ key: orgDefaultViewKey(table.tableKey), value: '' });
      toast.success(`Reset ${table.label} to shipped defaults`);
      setDraft(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reset');
    } finally {
      setSaving(false);
    }
  }

  async function handleRepullOne() {
    if (!table) return;
    const entitySet = resolveEntitySet(table.tableKey, dataSource);
    if (!entitySet) { toast.error(`${table.label} has no backing Dataverse table to re-pull.`); return; }
    // Snapshot the previous catalog before overwriting.
    const prevCatalog = reassembleColumnCatalog(settings, table.tableKey, catalogSource);
    const prevKeys = new Set(prevCatalog.map((c) => c.key));
    setRepull({ label: table.label, done: 0, total: 1 });
    try {
      const discovered = await discoverColumns(table.tableKey, dataSource);
      if (discovered.length === 0) {
        toast.error(`No columns returned for ${table.label}. Check access to ${entitySet} metadata.`);
        return;
      }
      await saveChunkedCatalog(
        table.tableKey, discovered, settings,
        (a) => upsert.mutateAsync(a),
        (a) => del.mutateAsync(a),
        catalogSource,
      );
      setDraft(null);

      // ── Post-pull checks ──────────────────────────────────────────────────
      const freshKeys = new Set(discovered.map((c) => c.key));
      const orgCfg = parseOrgDefaultView(savedRaw);
      const defaultViewKeys = new Set(orgCfg.columns ?? []);
      // Build a reverse map: display-label (lowercase) -> colKey for the formula field-ref check.
      // freshMerged is also reused below for the duplicate-label check (single computation).
      const freshMerged = mergeColumns(table.tableKey, discovered);
      const labelToKeyMap: Record<string, string> = {};
      for (const c of freshMerged) labelToKeyMap[c.header.toLowerCase()] = c.key;
      const formulaColKeys = new Set(
        customColumns.flatMap((f) =>
          extractFormulaFieldRefs(f.formula ?? '').map((label) => labelToKeyMap[label] ?? label)
        )
      );
      const labelKeys = new Set(Object.keys(labelOverrides));

      // Deletion blast-radius: catalog keys that disappeared AND are in active use.
      const impact: DeletedImpactItem[] = [];
      for (const key of prevKeys) {
        if (freshKeys.has(key)) continue; // still present — fine
        const inDV = defaultViewKeys.has(key);
        const inCF = formulaColKeys.has(key);
        const inLO = labelKeys.has(key);
        if (inDV || inCF || inLO) impact.push({ key, inDefaultView: inDV, inCustomFormulas: inCF, inLabelOverrides: inLO });
      }
      setDeletedImpact(impact);

      // Duplicate-label check: find label collisions after the pull.
      // Re-merge with the fresh discovered columns (not the stale hook data).
      const allCols = [
        ...freshMerged.map((c) => ({ key: c.key, header: c.header })),
        ...customColumns.map((f) => ({ key: customColumnRuntimeKey(f.id), header: f.label })),
      ];
      setDuplicateGroups(findDuplicateLabels(allCols, labelOverrides));

      toast.success(`Re-pulled ${discovered.length} columns for ${table.label}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Column re-pull failed');
    } finally {
      setRepull(null);
    }
  }

  async function handleRepullAll() {
    setRepull({ label: 'all tables', done: 0, total: DISCOVERABLE_TABLE_KEYS.length });
    try {
      const results = await discoverAllTables((done, total, current) => {
        setRepull({ label: current, done, total });
      }, dataSource);
      let okCount = 0;
      let colCount = 0;
      const failed: string[] = [];
      for (const r of results) {
        if (r.ok) {
          await saveChunkedCatalog(
            r.tableKey, r.columns, settings,
            (a) => upsert.mutateAsync(a),
            (a) => del.mutateAsync(a),
            r.source,
          );
          okCount++; colCount += r.columns.length;
        } else {
          failed.push(r.tableKey);
        }
      }
      setDraft(null);
      if (failed.length) {
        toast.warning(`Re-pulled ${okCount} tables (${colCount} columns). Failed: ${failed.join(', ')}.`);
      } else {
        toast.success(`Re-pulled ${okCount} tables (${colCount} columns).`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Re-pull all failed');
    } finally {
      setRepull(null);
    }
  }

  async function handleSaveCustomColumn(formula: CustomColumnFormula) {
    const isEdit = customFormMode !== 'new';
    const next = isEdit
      ? customColumns.map((f) => (f.id === formula.id ? formula : f))
      : [...customColumns, formula];
    try {
      await upsert.mutateAsync({ key: customColumnsKey(tableKey, catalogSource), value: JSON.stringify(next) });
      setCustomFormMode(null);
      setDraft(null);
      toast.success(isEdit ? `Custom column "${formula.label}" updated.` : `Custom column "${formula.label}" added.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save custom column');
    }
  }

  async function handleDeleteCustomColumn(formulaId: string) {
    const next = customColumns.filter((f) => f.id !== formulaId);
    await upsert.mutateAsync({ key: customColumnsKey(tableKey, catalogSource), value: JSON.stringify(next) });
    setDraft(null);
    if (customFormMode === formulaId) setCustomFormMode(null);
    setDeletingCustomCol(null);
    toast.success('Custom column removed.');
  }

  const busy = saving || repull !== null;

  // ── User Views tab ──────────────────────────────────────────────────────

  const loadUserViews = useCallback(async () => {
    setLoadingUserViews(true);
    try {
      const views = await listAllViewsForTable(tableKey);
      // Exclude the reserved __default__ width-save rows; show only named custom views.
      setAllUserViews(views.filter((v) => v.pmo_name !== '__default__'));
    } catch {
      toast.error('Failed to load user views');
    } finally {
      setLoadingUserViews(false);
    }
  }, [tableKey]);

  useEffect(() => {
    if (activeTab === 'user-views') void loadUserViews(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [activeTab, tableKey, loadUserViews]);

  async function handleDeleteUserView(viewId: string) {
    try {
      await deleteUserView(viewId);
      setAllUserViews((prev) => prev?.filter((v) => v.pmo_userviewid !== viewId) ?? null);
      setDeletingViewId(null);
      toast.success('View deleted.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete view');
    }
  }

  async function handleUpdateUserViewColumns(viewId: string, columns: string[]) {
    const view = allUserViews?.find((v) => v.pmo_userviewid === viewId);
    if (!view) return;
    try {
      const prev = view.pmo_config ? JSON.parse(view.pmo_config) as { columns?: string[]; widths?: Record<string, number> } : {};
      const next = JSON.stringify({ ...prev, columns });
      await updateUserViewConfig(viewId, next);
      setAllUserViews((all) => all?.map((v) =>
        v.pmo_userviewid === viewId ? { ...v, pmo_config: next } : v,
      ) ?? null);
      setEditingViewId(null);
      toast.success('View updated.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update view');
    }
  }

  // ── Deleted-column replacement ───────────────────────────────────────────
  // Swaps oldKey → newKey in: org Default view config, every pmo_userview for
  // this table, and clears the label override for oldKey.
  async function applyReplacement(oldKey: string) {
    const newKey = replacements[oldKey];
    if (!newKey) return;
    setApplyingReplacement(oldKey);
    try {
      // 1. Org Default view.
      const orgCfg = parseOrgDefaultView(savedRaw);
      if (orgCfg.columns?.includes(oldKey)) {
        const next = { ...orgCfg, columns: orgCfg.columns.map((k) => k === oldKey ? newKey : k) };
        await upsert.mutateAsync({ key: orgDefaultViewKey(tableKey), value: JSON.stringify(next) });
      }

      // 2. All user views for this table.
      const allViews = await listAllViewsForTable(tableKey);
      for (const view of allViews) {
        if (!view.pmo_config) continue;
        let cfg: { columns?: string[]; widths?: Record<string, number> };
        try { cfg = JSON.parse(view.pmo_config); } catch { continue; }
        const hasCol = cfg.columns?.includes(oldKey);
        const hasWidth = cfg.widths && oldKey in cfg.widths;
        if (!hasCol && !hasWidth) continue;
        const next: typeof cfg = { ...cfg };
        if (next.columns) next.columns = next.columns.map((k) => k === oldKey ? newKey : k);
        if (next.widths && oldKey in next.widths) {
          next.widths = { ...next.widths, [newKey]: next.widths[oldKey] };
          delete next.widths[oldKey];
        }
        await updateUserViewConfig(view.pmo_userviewid, JSON.stringify(next));
      }

      // 3. Clear label override for oldKey, copy to newKey if it existed.
      const oldLabel = labelOverrides[oldKey];
      if (oldLabel) {
        await setLabel(oldKey, '');
        await setLabel(newKey, oldLabel);
      }

      setDeletedImpact((prev) => prev.filter((i) => i.key !== oldKey));
      setReplacements((prev) => { const n = { ...prev }; delete n[oldKey]; return n; });
      setDraft(null);
      toast.success(`Replaced "${oldKey}" → "${newKey}" across all views.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Replacement failed');
    } finally {
      setApplyingReplacement(null);
    }
  }

  // Build the list of available column keys for the custom-column form picker.
  const availableForFormula = useMemo(() => {
    const seen = new Set<string>();
    return [
      ...mergedColumns.map((c) => ({ key: c.key, header: labelOverrides[c.key] ?? c.header })),
    ].filter((c) => { if (seen.has(c.key)) return false; seen.add(c.key); return true; });
  }, [mergedColumns, labelOverrides]);

  // The formula being edited (null when form is closed or in 'new' mode).
  const editingFormula = useMemo(
    () => (customFormMode && customFormMode !== 'new'
      ? customColumns.find((f) => f.id === customFormMode) ?? null
      : null),
    [customFormMode, customColumns],
  );

  // Table display label for the "Add Custom Column to X" button.
  const tableLabel = table?.label ?? 'Table';

  // Column search — filters the displayed list by display label or internal key.
  const [colSearch, setColSearch] = useState('');
  const displayedCols = useMemo(() => {
    const q = colSearch.trim().toLowerCase();
    if (!q) return cols;
    return cols.filter((c) =>
      c.header.toLowerCase().includes(q)
      || c.key.toLowerCase().includes(q)
      || (c.realKey ?? '').toLowerCase().includes(q),
    );
  }, [cols, colSearch]);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      {/* Section header + tab toggle */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <SectionHeader
          title="Table Views"
          description={activeTab === 'default'
            ? 'Configure the org-wide Default view for each list — which columns appear, their order, and default widths.'
            : 'Browse and manage all user-created custom views across your organization.'}
        />
        <div className="flex items-center gap-1 shrink-0 rounded-lg border border-border bg-muted/30 p-0.5">
          <button
            type="button"
            onClick={() => setActiveTab('default')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              activeTab === 'default' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Default View
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('user-views')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              activeTab === 'user-views' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Users className="h-3.5 w-3.5" />
            User Views
          </button>
        </div>
      </div>

      {/* Table/source picker — shared between both tabs */}
      <div className="flex items-center gap-3 mb-4">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Table</label>
        <Select value={tableKey} onValueChange={(v) => { setTableKey(v); setDraft(null); setCustomFormMode(null); setDuplicateGroups([]); setDeletedImpact([]); setColSearch(''); setAllUserViews(null); }}>
          <SelectTrigger className="w-56 h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TABLE_VIEW_REGISTRY.map((t) => (
              <SelectItem key={t.tableKey} value={t.tableKey}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {activeTab === 'default' && hasCatalog && (
          <span className="text-[11px] text-muted-foreground">
            catalog loaded{catalogLoadedAt ? ` · ${catalogLoadedAt.toLocaleDateString()}` : ''}
          </span>
        )}
      </div>

      {/* ══ USER VIEWS TAB ══════════════════════════════════════════════════ */}
      {activeTab === 'user-views' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">All custom views for <span className="font-medium text-foreground">{table?.label ?? tableKey}</span></p>
            <Button variant="outline" size="sm" onClick={loadUserViews} disabled={loadingUserViews}>
              {loadingUserViews ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
              Refresh
            </Button>
          </div>

          {loadingUserViews && (
            <div className="py-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading views…
            </div>
          )}

          {!loadingUserViews && allUserViews !== null && allUserViews.length === 0 && (
            <div className="py-8 text-center text-xs text-muted-foreground">No custom views for this table yet.</div>
          )}

          {!loadingUserViews && allUserViews && allUserViews.length > 0 && (
            <div className="rounded-md border border-border divide-y divide-border/60">
              {/* Header */}
              <div className="grid grid-cols-[1fr_1fr_auto_auto_auto] items-center gap-3 px-3 py-2 bg-muted/30 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span>View Name</span>
                <span>Created By</span>
                <span>Scope</span>
                <span className="w-20 text-center">Columns</span>
                <span className="w-16" />
              </div>
              {allUserViews.map((view) => {
                const cfg = view.pmo_config ? (() => { try { return JSON.parse(view.pmo_config!) as { columns?: string[]; widths?: Record<string, number> }; } catch { return {}; } })() : {};
                const colCount = cfg.columns?.length ?? 0;
                const ownerName = (view as unknown as Record<string, unknown>)['_pmo_user_value@OData.Community.Display.V1.FormattedValue'] as string | undefined;
                const teamName = (view as unknown as Record<string, unknown>)['_pmo_team_value@OData.Community.Display.V1.FormattedValue'] as string | undefined;
                const isEditing = editingViewId === view.pmo_userviewid;

                return (
                  <div key={view.pmo_userviewid} className="space-y-2 px-3 py-2">
                    <div className="grid grid-cols-[1fr_1fr_auto_auto_auto] items-center gap-3">
                      <span className="text-sm font-medium text-foreground truncate">{view.pmo_name}</span>
                      <span className="text-xs text-muted-foreground truncate">{ownerName ?? '—'}</span>
                      <span className="text-xs text-muted-foreground">
                        {view.pmo_scope === 'team' ? `Team: ${teamName ?? '—'}` : 'Personal'}
                      </span>
                      <span className="w-20 text-center text-xs text-muted-foreground tabular-nums">{colCount} cols</span>
                      <div className="w-16 flex items-center justify-end gap-1">
                        <button
                          type="button"
                          title="Edit view columns"
                          onClick={() => setEditingViewId((prev) => prev === view.pmo_userviewid ? null : view.pmo_userviewid)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Delete view"
                          onClick={() => setDeletingViewId(view.pmo_userviewid)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Inline column editor */}
                    {isEditing && (
                      <div className="ml-2 mt-1 rounded-md border border-border bg-muted/10 p-3 space-y-2">
                        <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">Visible columns for "{view.pmo_name}"</p>
                        <div className="max-h-48 overflow-auto space-y-0.5">
                          {cols.map((c) => {
                            const viewCols = cfg.columns ?? [];
                            const checked = viewCols.includes(c.key);
                            return (
                              <label key={c.key} className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    const next = checked ? viewCols.filter((k) => k !== c.key) : [...viewCols, c.key];
                                    handleUpdateUserViewColumns(view.pmo_userviewid, next);
                                  }}
                                  className="h-3 w-3 rounded accent-primary"
                                />
                                <span className="flex-1 truncate">{c.header || c.key}</span>
                                <span className="text-muted-foreground/50 font-mono text-[10px]">{c.key}</span>
                              </label>
                            );
                          })}
                        </div>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingViewId(null)}>Done</Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Delete confirm */}
          {deletingViewId && (() => {
            const v = allUserViews?.find((x) => x.pmo_userviewid === deletingViewId);
            if (!v) return null;
            return (
              <Dialog open onOpenChange={(o) => { if (!o) setDeletingViewId(null); }}>
                <DialogContent className="max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Delete view</DialogTitle>
                    <DialogDescription>Permanently delete <span className="font-semibold text-foreground">{v.pmo_name}</span>? This cannot be undone.</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="secondary" size="sm" onClick={() => setDeletingViewId(null)}>Cancel</Button>
                    <Button size="sm" className="bg-rose-600 hover:bg-rose-700 text-white" onClick={() => handleDeleteUserView(deletingViewId)}>Delete</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            );
          })()}
        </div>
      )}

      {/* ══ DEFAULT VIEW TAB ════════════════════════════════════════════════ */}
      {activeTab === 'default' && <>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2" />
        <div className="flex items-center gap-2">
          {/* Add Custom Column — purple pill, table-aware label */}
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setCustomFormMode((m) => m === null ? 'new' : null)}
            className="border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-400 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Custom Column to {tableLabel}
          </Button>
          <Button variant="outline" size="sm" onClick={handleRepullOne} disabled={busy} title="Discover this table's columns from Dataverse metadata">
            {repull && repull.total === 1 ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            Re-pull columns
          </Button>
          <Button variant="outline" size="sm" onClick={handleRepullAll} disabled={busy} title="Discover columns for every table from Dataverse metadata">
            {repull && repull.total > 1 ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            Re-pull all tables
          </Button>
        </div>
      </div>

      {repull && (
        <div className="mb-3 text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Discovering columns — {repull.label} ({repull.done}/{repull.total})
        </div>
      )}

      {/* Delete-confirm dialog for custom columns */}
      {deletingCustomCol && (
        <DeleteCustomColDialog
          columnLabel={deletingCustomCol.label}
          onCancel={() => setDeletingCustomCol(null)}
          onConfirm={() => handleDeleteCustomColumn(deletingCustomCol.id)}
        />
      )}

      {/* Custom column dialog — shown when adding or editing */}
      {customFormMode !== null && (
        <CustomColForm
          availableKeys={availableForFormula}
          allTeams={allTeams}
          initialFormula={editingFormula ?? undefined}
          onSave={handleSaveCustomColumn}
          onCancel={() => setCustomFormMode(null)}
        />
      )}

      {/* ── Deletion blast-radius warning ─────────────────────────────────────
           Shown after a re-pull when previously-cataloged columns disappear
           from Dataverse and are still referenced in active configuration. */}
      {deletedImpact.length > 0 && (
        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-destructive">
              ⚠ {deletedImpact.length} column{deletedImpact.length !== 1 ? 's' : ''} removed from Dataverse metadata but still in use
            </p>
            <button type="button" onClick={() => setDeletedImpact([])} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
          </div>
          <ul className="space-y-2">
            {deletedImpact.map((item) => (
              <li key={item.key} className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-foreground">{item.key}</span>
                  <span className="text-xs text-muted-foreground">
                    — used in: {[item.inDefaultView && 'Default View', item.inCustomFormulas && 'Custom Columns', item.inLabelOverrides && 'Column Renames'].filter(Boolean).join(', ')}
                  </span>
                </div>
                {/* Replacement picker: choose a column from the fresh catalog, apply swap everywhere. */}
                <div className="flex items-center gap-2">
                  <Select
                    value={replacements[item.key] ?? '__none__'}
                    onValueChange={(v) => setReplacements((prev) => ({ ...prev, [item.key]: v === '__none__' ? '' : v }))}
                  >
                    <SelectTrigger className="h-7 text-xs flex-1 max-w-xs">
                      <SelectValue placeholder="Replace with…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— no replacement —</SelectItem>
                      {mergedColumns
                        .filter((c) => !c.isRemoved && c.key !== item.key)
                        .map((c) => (
                          <SelectItem key={c.key} value={c.key}>
                            {labelOverrides[c.key] ?? c.header} <span className="text-muted-foreground/60 font-mono text-[10px] ml-1">{c.key}</span>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    disabled={!replacements[item.key] || applyingReplacement === item.key}
                    onClick={() => applyReplacement(item.key)}
                  >
                    {applyingReplacement === item.key
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <ArrowRightLeft className="h-3 w-3" />}
                    {applyingReplacement === item.key ? 'Applying…' : 'Apply to all views'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            Select a replacement column and click "Apply to all views" to swap the deleted column across the Default view, all user custom views, and label overrides.
          </p>
        </div>
      )}

      {/* ── Duplicate-label advisory ─────────────────────────────────────────
           Shown after a re-pull when 2+ columns share the same display name.
           Offers inline rename for each conflicting column. */}
      {duplicateGroups.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
              {duplicateGroups.length > 1 ? `${duplicateGroups.length} groups of ` : ''}Columns with duplicate display names found after re-pull
            </p>
            <button type="button" onClick={() => setDuplicateGroups([])} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
          </div>
          {duplicateGroups.map((group) => (
            <div key={group.label} className="space-y-1">
              <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                "{group.label}" — {group.keys.length} columns share this name:
              </p>
              <ul className="space-y-0.5">
                {group.keys.map((key) => {
                  const colState = cols.find((c) => c.key === key);
                  const currentHeader = colState?.header ?? key;
                  return (
                    <li key={key} className="flex items-center gap-2">
                      <span className="text-[11px] font-mono text-muted-foreground">{key}</span>
                      <button
                        type="button"
                        onClick={() => startRename(key, currentHeader)}
                        className="text-[11px] text-primary hover:underline"
                      >
                        Rename
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Column search */}
      <div className="relative mt-3 mb-2">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={colSearch}
          onChange={(e) => setColSearch(e.target.value)}
          placeholder="Search columns by name or key…"
          className="h-8 pl-8 text-sm"
        />
        {colSearch && (
          <button
            type="button"
            onClick={() => setColSearch('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="rounded-md border border-border divide-y divide-border/60">
        {/* Header row */}
        <div className="grid grid-cols-[auto_auto_1fr_auto_auto] items-center gap-3 px-3 py-2 bg-muted/30 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="w-5" />
          <span className="w-16 text-center">Order</span>
          <span>Column / Name</span>
          <span className="w-24 text-center">Width (px)</span>
          <span className="w-6" />
        </div>

        {colSearch && displayedCols.length === 0 && (
          <div className="px-3 py-6 text-xs text-muted-foreground text-center">No columns match "{colSearch}"</div>
        )}

        {displayedCols.map((c) => {
          const i = cols.findIndex((col) => col.key === c.key);
          const isBeingRenamed = renamingKey === c.key;
          const customId = c.isCustom ? c.key.slice(CUSTOM_COL_PREFIX.length) : null;
          const isBeingEdited = customFormMode === customId;

          return (
            <div
              key={c.key}
              draggable={!isBeingRenamed}
              onDragStart={(e) => {
                setDragKey(c.key);
                e.dataTransfer.setData('application/x-view-col', c.key);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={dragKey && dragKey !== c.key ? (e) => {
                if (e.dataTransfer.types.includes('application/x-view-col')) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverKey !== c.key) setDragOverKey(c.key);
                }
              } : undefined}
              onDrop={(e) => {
                e.preventDefault();
                const dragged = e.dataTransfer.getData('application/x-view-col');
                reorderByKey(dragged, c.key);
                setDragKey(null); setDragOverKey(null);
              }}
              onDragEnd={() => { setDragKey(null); setDragOverKey(null); }}
              className={cn(
                'grid grid-cols-[auto_auto_1fr_auto_auto] items-center gap-3 px-3 py-2 transition-colors',
                !c.visible && 'opacity-50',
                dragKey === c.key && 'opacity-40',
                dragOverKey === c.key && 'bg-primary/5 ring-1 ring-inset ring-primary/30',
                c.isRemoved && 'bg-destructive/5',
                isBeingEdited && 'bg-indigo-50/60 dark:bg-indigo-950/20',
              )}
            >
              {/* Drag handle */}
              <span className="w-5 flex items-center justify-center text-muted-foreground cursor-grab active:cursor-grabbing" title="Drag to reorder">
                <GripVertical className="h-4 w-4" />
              </span>

              {/* Order input */}
              <Input
                type="number"
                min={1}
                max={cols.length}
                value={i + 1}
                onChange={(e) => setOrder(i, e.target.value)}
                className="w-16 h-8 text-sm text-center"
                aria-label={`Order for ${c.header || c.key}`}
              />

              {/* Column label + badges + rename */}
              <label className="flex items-center gap-2 text-sm cursor-pointer min-w-0">
                <input
                  type="checkbox"
                  checked={c.visible}
                  disabled={c.isRemoved}
                  onChange={() => toggle(i)}
                  className="h-3.5 w-3.5 rounded border-border accent-primary shrink-0"
                />
                {isBeingRenamed ? (
                  <Input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(c.key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(c.key); }
                      if (e.key === 'Escape') { setRenamingKey(null); }
                    }}
                    className="h-7 text-sm flex-1 min-w-0"
                    onClick={(e) => e.preventDefault()}
                  />
                ) : (
                  <span className="flex flex-col min-w-0">
                    <button
                      type="button"
                      title="Click to rename"
                      onClick={(e) => { e.preventDefault(); startRename(c.key, c.header); }}
                      className={cn(
                        'truncate text-left hover:underline hover:text-foreground transition-colors text-sm leading-tight',
                        c.isRemoved && 'line-through text-muted-foreground',
                      )}
                    >
                      {c.header || c.key}
                    </button>
                    {/* Internal key — read-only, settings-only, never shown outside admin.
                        When the shipped key is a normalizer alias, show the REAL
                        Dataverse attribute name (what the data is actually stored in). */}
                    <span className="text-[10px] text-muted-foreground/60 truncate font-mono leading-tight">
                      {c.realKey ?? c.key}
                      {c.realKey && <span className="text-muted-foreground/40"> (app key: {c.key})</span>}
                    </span>
                  </span>
                )}
                {/* Badges */}
                {c.isVirtual && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400 text-[10px] font-medium shrink-0">Virtual</span>
                )}
                {c.isLookup && !c.isVirtual && (
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 text-[10px] font-medium shrink-0"
                    title={c.targets && c.targets.length ? `Lookup → ${c.targets.join(', ')}` : 'Lookup column'}
                  >Lookup</span>
                )}
                {c.isLookup && !c.isVirtual && (
                  <Select
                    value={lookupAspects[c.key] ?? 'name'}
                    onValueChange={(v) => { void setLookupAspect(c.key, v); }}
                  >
                    <SelectTrigger className="h-6 w-28 text-[11px] px-2 shrink-0" title="Which part of the linked record to display">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {aspectOptionsFor(c.targets).map((a) => (
                        <SelectItem key={a.id} value={a.id} className="text-xs">{a.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {c.isNew && !c.isVirtual && !c.isCustom && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-[10px] font-medium shrink-0">New</span>
                )}
                {c.isRemoved && !c.isVirtual && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive text-[10px] font-medium shrink-0">Removed</span>
                )}
                {c.isCustom && (
                  <button
                    type="button"
                    title="Click to view / edit formula"
                    onClick={(e) => {
                      e.preventDefault();
                      if (customId) setCustomFormMode((m) => m === customId ? null : customId);
                    }}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 text-[10px] font-medium shrink-0 hover:bg-indigo-200 dark:hover:bg-indigo-800/40 transition-colors"
                  >
                    Custom
                    <Pencil className="h-2.5 w-2.5" />
                  </button>
                )}
              </label>

              {/* Width input */}
              <Input
                type="number"
                value={c.width}
                onChange={(e) => setWidth(i, e.target.value)}
                placeholder="auto"
                className="w-24 h-8 text-sm"
                disabled={c.isRemoved}
              />

              {/* Delete button (custom columns only) */}
              <div className="w-6 flex items-center justify-center">
                {c.isCustom && customId && (
                  <button
                    type="button"
                    onClick={() => {
                      const formula = customColumns.find((f) => f.id === customId);
                      if (formula) setDeletingCustomCol({ id: formula.id, label: formula.label });
                    }}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                    title="Delete custom column"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-2 mt-4">
        <Button variant="ghost" size="sm" onClick={handleReset} disabled={busy} title="Clear the org default; tables revert to shipped column order">
          <RotateCcw className="h-3.5 w-3.5 mr-1" />
          Reset to shipped defaults
        </Button>
        <Button size="sm" onClick={handleSave} disabled={busy}>
          {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
          {saving ? 'Saving…' : 'Save default view'}
        </Button>
      </div>
      </>}
    </div>
  );
}
