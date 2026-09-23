/**
 * ViewSwitcher — the header-level dropdown (SharePoint-style) that lets a user
 * switch between the built-in Default View and their own custom views, create a
 * new view (pick which columns show, pre-set filters + sort), rename, or delete
 * one.
 *
 * Pure presentation over a `useTableViews` result; DataTable owns the state.
 */
import { useState, useMemo } from 'react';
import { ChevronDown, Plus, Check, Trash2, Pencil, LayoutGrid, Search } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuLabel,
} from '../ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../ui/dialog';
import { cn } from '../../lib/utils';
import { toast } from '../../hooks/useToast';
import type { TableViewOption } from '../../hooks/useTableViews';
import type { ViewScope } from '../../models/userView.model';
import { MultiSelectFilter } from './MultiSelectFilter';
import { aspectOptionsFor } from '../../lib/lookupResolver';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { CustomColForm, type CustomColScope } from '../admin/TableViewsSection';
import type { CustomColumnFormula } from '../../lib/customColumns';

export interface ColumnOption {
  key: string;
  header: string;
  /** Columns that must always be present (e.g. a pinned action column). */
  locked?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  filterMode?: 'single' | 'multi';
  filterOptions?: { value: string; label: string }[];
  /** True when this is a lookup column (offers an aspect picker). */
  isLookup?: boolean;
  /** Lookup target entity logical name(s), for the aspect options. */
  targets?: string[];
}

interface Props {
  options: TableViewOption[];
  activeViewId: string;
  onSelect: (id: string) => void;
  /** All columns available to include in a custom view. */
  columns: ColumnOption[];
  /** Teams the user can share a view with (their PMO/nav teams). */
  teamOptions: { id: string; name: string }[];
  onCreateView: (name: string, columns: string[], scope: ViewScope, teamId?: string | null, filters?: Record<string, string | string[]>, sort?: { key: string; dir: 'asc' | 'desc' } | null, aspects?: Record<string, string>) => Promise<void>;
  onUpdateView: (id: string, name: string, columns: string[], scope: ViewScope, teamId?: string | null, filters?: Record<string, string | string[]>, sort?: { key: string; dir: 'asc' | 'desc' } | null, aspects?: Record<string, string>) => Promise<void>;
  onDeleteView: (id: string) => Promise<void>;
  /** Current selected column keys for a view (to prefill the editor). */
  getViewColumns: (id: string) => string[];
  /** Current scope + team of a view (to prefill the editor). */
  getViewScope: (id: string) => { scope: ViewScope; teamId: string | null };
  /** Saved filters + sort for a view (to prefill the editor). */
  getViewFiltersSort: (id: string) => { filters: Record<string, string | string[]>; sort: { key: string; dir: 'asc' | 'desc' } | null };
  /** Saved per-view lookup aspects (colKey -> aspect) to prefill the editor. */
  getViewAspects?: (id: string) => Record<string, string>;
  /** The table's current live filters (offered as "start from current" in create). */
  currentFilters?: Record<string, string | string[]>;
  /** The table's current live sort. */
  currentSort?: { key: string; dir: 'asc' | 'desc' } | null;
  /** Create a user/team custom column (formula). When absent, the 'New column' action is hidden. */
  onCreateCustomColumn?: (formula: CustomColumnFormula, scope: CustomColScope, teamId: string | null) => Promise<void>;
}

export function ViewSwitcher({
  options, activeViewId, onSelect, columns, teamOptions,
  onCreateView, onUpdateView, onDeleteView,
  getViewColumns, getViewScope, getViewFiltersSort, getViewAspects,
  currentFilters, currentSort, onCreateCustomColumn,
}: Props) {
  const active = options.find((o) => o.id === activeViewId) ?? options[0];
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TableViewOption | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TableViewOption | null>(null);
  const [newColOpen, setNewColOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5">
            <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="max-w-[160px] truncate">{active?.name ?? 'Default View'}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Views
          </DropdownMenuLabel>
          {options.map((opt) => (
            <DropdownMenuItem
              key={opt.id}
              onSelect={() => onSelect(opt.id)}
              className="flex items-center gap-2"
            >
              <Check className={cn('h-3.5 w-3.5 shrink-0', opt.id === activeViewId ? 'opacity-100 text-primary' : 'opacity-0')} />
              <span className="flex-1 truncate">{opt.name}</span>
              {!opt.isDefault && (
                <span className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    aria-label={`Edit ${opt.name}`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditTarget(opt); }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${opt.name}`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleteTarget(opt); }}
                    className="text-muted-foreground hover:text-rose-600"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-3.5 w-3.5" />
            New view…
          </DropdownMenuItem>
          {onCreateCustomColumn && (
            <DropdownMenuItem onSelect={() => setNewColOpen(true)} className="gap-2">
              <Plus className="h-3.5 w-3.5" />
              New column…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {createOpen && (
        <ViewEditorDialog
          title="New view"
          description="Name your view, choose columns, and optionally pre-set filters and sort."
          columns={columns}
          teamOptions={teamOptions}
          initialName=""
          initialSelected={[]}
          initialScope="personal"
          initialTeamId={null}
          initialFilters={currentFilters ?? {}}
          initialSort={currentSort ?? null}
          initialAspects={{}}
          onCancel={() => setCreateOpen(false)}
          onSave={async (name, cols, scope, teamId, filters, sort, aspects) => {
            await onCreateView(name, cols, scope, teamId, filters, sort, aspects);
            setCreateOpen(false);
          }}
        />
      )}

      {editTarget && (
        <ViewEditorDialog
          title="Edit view"
          description="Update the name, columns, filters, and sort for this view."
          columns={columns}
          teamOptions={teamOptions}
          initialName={editTarget.name}
          initialSelected={getViewColumns(editTarget.id)}
          initialScope={getViewScope(editTarget.id).scope}
          initialTeamId={getViewScope(editTarget.id).teamId}
          initialFilters={getViewFiltersSort(editTarget.id).filters}
          initialSort={getViewFiltersSort(editTarget.id).sort}
          initialAspects={getViewAspects ? getViewAspects(editTarget.id) : {}}
          onCancel={() => setEditTarget(null)}
          onSave={async (name, cols, scope, teamId, filters, sort, aspects) => {
            await onUpdateView(editTarget.id, name, cols, scope, teamId, filters, sort, aspects);
            setEditTarget(null);
          }}
        />
      )}

      {deleteTarget && (
        <DeleteViewDialog
          view={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => { await onDeleteView(deleteTarget.id); setDeleteTarget(null); }}
        />
      )}

      {newColOpen && onCreateCustomColumn && (
        <CustomColForm
          variant="user"
          availableKeys={columns.map((c) => ({ key: c.key, header: c.header }))}
          allTeams={teamOptions.map((t) => ({ teamid: t.id, name: t.name }))}
          onCancel={() => setNewColOpen(false)}
          onSaveScoped={async (formula, scope, teamId) => {
            await onCreateCustomColumn(formula, scope, teamId);
            setNewColOpen(false);
          }}
        />
      )}
    </>
  );
}

interface EditorProps {
  title: string;
  description: string;
  columns: ColumnOption[];
  teamOptions: { id: string; name: string }[];
  initialName: string;
  initialSelected: string[];
  initialScope: ViewScope;
  initialTeamId: string | null;
  initialFilters: Record<string, string | string[]>;
  initialSort: { key: string; dir: 'asc' | 'desc' } | null;
  initialAspects: Record<string, string>;
  onCancel: () => void;
  onSave: (name: string, columns: string[], scope: ViewScope, teamId: string | null, filters: Record<string, string | string[]>, sort: { key: string; dir: 'asc' | 'desc' } | null, aspects: Record<string, string>) => Promise<void>;
}

function ViewEditorDialog({
  title, description, columns, teamOptions,
  initialName, initialSelected, initialScope, initialTeamId,
  initialFilters, initialSort, initialAspects,
  onCancel, onSave,
}: EditorProps) {
  const [name, setName] = useState(initialName);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelected));
  const [scope, setScope] = useState<ViewScope>(initialScope);
  const [teamId, setTeamId] = useState<string | null>(
    initialTeamId ?? (teamOptions.length === 1 ? teamOptions[0].id : null),
  );
  const [saving, setSaving] = useState(false);

  // Column search
  const [colSearch, setColSearch] = useState('');
  const filteredColumns = useMemo(() => {
    const q = colSearch.trim().toLowerCase();
    if (!q) return columns;
    return columns.filter((c) => c.header.toLowerCase().includes(q) || c.key.toLowerCase().includes(q));
  }, [columns, colSearch]);

  // Filters pre-set state
  const [filters, setFilters] = useState<Record<string, string | string[]>>(initialFilters);

  // Sort pre-set state
  const [sortColKey, setSortColKey] = useState<string>(initialSort?.key ?? '');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialSort?.dir ?? 'asc');

  // Per-column lookup aspect (colKey -> aspect) for THIS view. Empty ⇒ inherit
  // the org default (then 'name'), which is exactly what the view shows today.
  const [aspects, setAspects] = useState<Record<string, string>>(initialAspects);
  // Selected lookup columns that expose more than the default Name aspect.
  const aspectCols = useMemo(
    () => columns.filter((c) => c.isLookup && (selected.has(c.key) || c.locked) && aspectOptionsFor(c.targets).length > 1),
    [columns, selected],
  );

  // Every selected column can get a default-filter control: columns with
  // predefined filterOptions show the multi/single-select; every other
  // selected column gets a free-text "contains" filter box.
  const filterableCols = useMemo(
    () => columns.filter((c) => selected.has(c.key) || c.locked),
    [columns, selected],
  );

  // Columns that are sortable (and are selected in the view)
  const sortableCols = useMemo(
    () => columns.filter((c) => c.sortable && (selected.has(c.key) || c.locked)),
    [columns, selected],
  );

  function toggle(key: string, locked?: boolean) {
    if (locked) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const needsTeam = scope === 'team' && !teamId;
  const canSave = name.trim().length > 0 && selected.size > 0 && !needsTeam;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const cols = columns.filter((c) => c.locked || selected.has(c.key)).map((c) => c.key);
      // Strip empty/blank filter values before saving
      const cleanFilters: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(filters)) {
        if (Array.isArray(v) ? v.length > 0 : v && v !== '__all__') cleanFilters[k] = v;
      }
      const sort = sortColKey ? { key: sortColKey, dir: sortDir } : null;
      const cleanAspects: Record<string, string> = {};
      for (const [k, v] of Object.entries(aspects)) {
        if (v && v !== 'name' && (selected.has(k) || columns.find((c) => c.key === k)?.locked)) cleanAspects[k] = v;
      }
      await onSave(name.trim(), cols, scope, scope === 'team' ? teamId : null, cleanFilters, sort, cleanAspects);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save view');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">

          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My at-risk projects" autoFocus />
          </div>

          {/* Columns with search */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Columns
            </label>
            {/* Search box */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={colSearch}
                onChange={(e) => setColSearch(e.target.value)}
                placeholder="Search columns…"
                className="h-8 pl-8 text-sm"
              />
            </div>
            <div className="max-h-48 overflow-auto rounded-md border border-border divide-y divide-border/60">
              {filteredColumns.length === 0 && (
                <p className="px-3 py-4 text-xs text-muted-foreground text-center">No columns match "{colSearch}"</p>
              )}
              {filteredColumns.map((c) => (
                <label
                  key={c.key}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 text-sm',
                    c.locked ? 'text-muted-foreground cursor-not-allowed' : 'cursor-pointer hover:bg-muted/40',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={c.locked || selected.has(c.key)}
                    disabled={c.locked}
                    onChange={() => toggle(c.key, c.locked)}
                    className="h-3.5 w-3.5 rounded border-border accent-primary"
                  />
                  <span className="flex-1 truncate">{c.header || c.key}</span>
                  {c.locked && <span className="text-[10px] uppercase tracking-wider">pinned</span>}
                </label>
              ))}
            </div>
            {selected.size > 0 && (
              <p className="text-[11px] text-muted-foreground">{selected.size} column{selected.size !== 1 ? 's' : ''} selected</p>
            )}
          </div>

          {/* Lookup aspect: choose which part of each selected lookup column to show */}
          {aspectCols.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Lookup display
              </label>
              <div className="rounded-md border border-border divide-y divide-border/60">
                {aspectCols.map((c) => (
                  <div key={c.key} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="text-sm truncate">{c.header || c.key}</span>
                    <Select
                      value={aspects[c.key] ?? 'name'}
                      onValueChange={(v) => setAspects((prev) => ({ ...prev, [c.key]: v }))}
                    >
                      <SelectTrigger className="h-7 w-32 text-xs shrink-0"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {aspectOptionsFor(c.targets).map((a) => (
                          <SelectItem key={a.id} value={a.id} className="text-xs">{a.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pre-set sort */}
          {sortableCols.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Default sort
              </label>
              <div className="flex gap-2">
                <select
                  value={sortColKey}
                  onChange={(e) => setSortColKey(e.target.value)}
                  className="flex-1 h-8 rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="">None</option>
                  {sortableCols.map((c) => (
                    <option key={c.key} value={c.key}>{c.header || c.key}</option>
                  ))}
                </select>
                {sortColKey && (
                  <select
                    value={sortDir}
                    onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}
                    className="w-28 h-8 rounded-md border border-border bg-background px-2 text-sm"
                  >
                    <option value="asc">A → Z</option>
                    <option value="desc">Z → A</option>
                  </select>
                )}
              </div>
            </div>
          )}

          {/* Pre-set filters */}
          {filterableCols.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Default filters
              </label>
              <div className="space-y-2">
                {filterableCols.map((col) => {
                  const val = filters[col.key];
                  if (!col.filterOptions?.length) {
                    // Free-text contains filter for columns without predefined options.
                    const textVal = Array.isArray(val) ? (val[0] ?? '') : (val ?? '');
                    return (
                      <div key={col.key} className="space-y-1">
                        <p className="text-[11px] text-muted-foreground">{col.header}</p>
                        <Input
                          value={textVal}
                          onChange={(e) => setFilters((prev) => ({ ...prev, [col.key]: e.target.value }))}
                          placeholder={`Contains…`}
                          className="h-8 text-sm"
                        />
                      </div>
                    );
                  }
                  if (col.filterMode === 'multi') {
                    const multiVal = Array.isArray(val) ? val : (val ? [val] : []);
                    return (
                      <div key={col.key} className="space-y-1">
                        <p className="text-[11px] text-muted-foreground">{col.header}</p>
                        <MultiSelectFilter
                          header={col.header}
                          options={col.filterOptions}
                          value={multiVal}
                          onChange={(v) => setFilters((prev) => ({ ...prev, [col.key]: v }))}
                        />
                      </div>
                    );
                  }
                  // single-select
                  const singleVal = Array.isArray(val) ? (val[0] ?? '') : (val ?? '');
                  return (
                    <div key={col.key} className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">{col.header}</p>
                      <select
                        value={singleVal}
                        onChange={(e) => setFilters((prev) => ({ ...prev, [col.key]: e.target.value }))}
                        className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm"
                      >
                        <option value="">All</option>
                        {col.filterOptions.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Sharing scope */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Who can see this</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setScope('personal')}
                className={cn(
                  'flex-1 rounded-md border px-3 py-2 text-sm text-left transition-colors',
                  scope === 'personal' ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:bg-muted/40',
                )}
              >
                <div className="font-medium">Personal</div>
                <div className="text-[11px] text-muted-foreground">Only you</div>
              </button>
              <button
                type="button"
                onClick={() => setScope('team')}
                disabled={teamOptions.length === 0}
                title={teamOptions.length === 0 ? 'You are not on any team' : undefined}
                className={cn(
                  'flex-1 rounded-md border px-3 py-2 text-sm text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                  scope === 'team' ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:bg-muted/40',
                )}
              >
                <div className="font-medium">Team</div>
                <div className="text-[11px] text-muted-foreground">Everyone on the team</div>
              </button>
            </div>
            {scope === 'team' && teamOptions.length > 1 && (
              <select
                value={teamId ?? ''}
                onChange={(e) => setTeamId(e.target.value || null)}
                className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="">Select a team…</option>
                {teamOptions.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
            {scope === 'team' && teamOptions.length === 1 && (
              <p className="text-[11px] text-muted-foreground">Shared with <span className="font-medium">{teamOptions[0].name}</span>.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * DeleteViewDialog — type-to-confirm delete. The user must type the view's
 * exact name before the Delete button enables, guarding against accidental
 * removal of a shared team view.
 */
function DeleteViewDialog({ view, onCancel, onConfirm }: {
  view: TableViewOption;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const match = typed.trim() === view.name.trim();

  async function handleConfirm() {
    if (!match) return;
    setDeleting(true);
    try {
      await onConfirm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete view');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete view</DialogTitle>
          <DialogDescription>
            This permanently deletes the view for everyone it is shared with. To confirm, type the view name
            {' '}<span className="font-semibold text-foreground">{view.name}</span> below.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={view.name}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && match) void handleConfirm(); }}
          />
        </div>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={deleting}>Cancel</Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={!match || deleting}
            className="bg-rose-600 hover:bg-rose-700 text-white"
          >
            {deleting ? 'Deleting…' : 'Delete view'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
