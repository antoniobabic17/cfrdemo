/**
 * ApplyTemplateDialog — pick / create / share task-list templates for the board.
 *
 * Mirrors the saved-Views sharing model: choose a PREDEFINED template, one of
 * MY templates, or a TEAM template — or create your own (from scratch or from
 * the current board) and keep it Personal or share with a Team.
 *
 * Applying is delegated to the parent via `onApply(tasks)` so the PSS-vs-custom
 * branch stays centralized in TaskWorkspace.
 */
import { useMemo, useState } from 'react';
import {
  LayoutTemplate, Plus, Trash2, Flag, Loader2, ChevronRight, Users, User, Sparkles, X,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import { toast } from '../../hooks/useToast';
import { useTaskTemplates, type ResolvedTemplate } from '../../hooks/useTaskTemplates';
import { useCurrentUserTeamsWithNames } from '../../hooks/useCurrentUserTeams';
import { serializeTaskPayload } from '../../models/taskTemplate.model';
import type { TemplateTask } from '../../lib/projectTemplates';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Apply the chosen template's tasks to the board (parent owns PSS/custom branch). */
  onApply: (tasks: TemplateTask[]) => Promise<void> | void;
  applying: boolean;
  /** Current board tasks, for "save current tasks as template". */
  boardTasks: { subject: string; isMilestone: boolean }[];
}

type Mode = 'choose' | 'create';

export function ApplyTemplateDialog({ open, onClose, onApply, applying, boardTasks }: Props) {
  const { predefined, mine, team, userId, create, remove } = useTaskTemplates();
  const teams = useCurrentUserTeamsWithNames() ?? [];

  const [mode, setMode] = useState<Mode>('choose');
  const [selectedId, setSelectedId] = useState<string>('');

  // Create/save state
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'personal' | 'team'>('personal');
  const [teamId, setTeamId] = useState('');
  const [rows, setRows] = useState<TemplateTask[]>([{ subject: '', isMilestone: false }]);

  const allById = useMemo(() => {
    const m = new Map<string, ResolvedTemplate>();
    [...predefined, ...mine, ...team].forEach((t) => m.set(t.id, t));
    return m;
  }, [predefined, mine, team]);

  function resetCreate() {
    setName(''); setScope('personal'); setTeamId(''); setRows([{ subject: '', isMilestone: false }]);
  }

  function beginCreateFromScratch() { resetCreate(); setMode('create'); }
  function beginSaveFromBoard() {
    resetCreate();
    setRows(boardTasks.length ? boardTasks.map((t) => ({ subject: t.subject, isMilestone: t.isMilestone })) : [{ subject: '', isMilestone: false }]);
    setMode('create');
  }

  async function handleApply() {
    const t = allById.get(selectedId);
    if (!t) return;
    if (t.tasks.length === 0) { toast.error('This template has no tasks.'); return; }
    await onApply(t.tasks);
  }

  async function handleSaveNew() {
    const cleanRows = rows.filter((r) => r.subject.trim() !== '');
    if (!name.trim()) { toast.error('Give the template a name.'); return; }
    if (cleanRows.length === 0) { toast.error('Add at least one task.'); return; }
    if (scope === 'team' && !teamId) { toast.error('Pick a team to share with.'); return; }
    if (!userId) { toast.error('Could not resolve your user.'); return; }
    try {
      await create.mutateAsync({
        pmo_name: name.trim(),
        pmo_taskpayload: serializeTaskPayload(cleanRows),
        pmo_scope: scope,
        'pmo_User@odata.bind': `/systemusers(${userId.replace(/[{}]/g, '')})`,
        ...(scope === 'team' ? { 'pmo_Team@odata.bind': `/teams(${teamId.replace(/[{}]/g, '')})` } : {}),
      });
      toast.success(`Saved template "${name.trim()}" (${scope === 'team' ? 'shared with team' : 'personal'})`);
      setMode('choose');
    } catch {
      /* MutationCache surfaces the error toast */
    }
  }

  async function handleDelete(t: ResolvedTemplate) {
    if (t.isFallback || t.scope === 'system') return;
    try { await remove.mutateAsync(t.id); toast.success(`Deleted "${t.name}"`); if (selectedId === t.id) setSelectedId(''); }
    catch { /* handled globally */ }
  }

  function updateRow(i: number, patch: Partial<TemplateTask>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() { setRows((prev) => [...prev, { subject: '', isMilestone: false }]); }
  function removeRow(i: number) { setRows((prev) => prev.filter((_, idx) => idx !== i)); }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setMode('choose'); setSelectedId(''); } }}>
      <DialogContent className="max-w-lg">
        {mode === 'choose' ? (
          <>
            <DialogHeader>
              <DialogTitle>Apply Task Template</DialogTitle>
              <DialogDescription>
                Choose a predefined template, one of your own, or a team template. Tasks land in
                the "No bucket" column and can be dragged into buckets.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-1 max-h-[22rem] overflow-y-auto">
              <TemplateGroup title="Predefined" icon={Sparkles} items={predefined} selectedId={selectedId} onSelect={setSelectedId} />
              <TemplateGroup title="My Templates" icon={User} items={mine} selectedId={selectedId} onSelect={setSelectedId} onDelete={handleDelete} />
              <TemplateGroup title="Team Templates" icon={Users} items={team} selectedId={selectedId} onSelect={setSelectedId} onDelete={handleDelete} />
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-between">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={beginCreateFromScratch}><Plus className="h-3.5 w-3.5 mr-1.5" />Create new</Button>
                <Button variant="outline" size="sm" onClick={beginSaveFromBoard} disabled={boardTasks.length === 0} title={boardTasks.length === 0 ? 'No tasks on the board yet' : undefined}><LayoutTemplate className="h-3.5 w-3.5 mr-1.5" />Save current tasks</Button>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
                <Button size="sm" disabled={!selectedId || applying} onClick={() => void handleApply()}>
                  {applying ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Flag className="h-3.5 w-3.5 mr-1.5" />}
                  Apply
                </Button>
              </div>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>New Task Template</DialogTitle>
              <DialogDescription>Add tasks, name it, and choose to keep it personal or share with a team.</DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-1">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" />

              <div className="rounded-md border border-border max-h-56 overflow-y-auto divide-y divide-border/50">
                {rows.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1.5">
                    <Input value={r.subject} onChange={(e) => updateRow(i, { subject: e.target.value })} placeholder={`Task ${i + 1}`} className="h-8 text-sm" />
                    <label className="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0 cursor-pointer">
                      <input type="checkbox" checked={r.isMilestone ?? false} onChange={(e) => updateRow(i, { isMilestone: e.target.checked })} />
                      Milestone
                    </label>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => removeRow(i)} disabled={rows.length === 1}><X className="h-3.5 w-3.5" /></Button>
                  </div>
                ))}
                <button type="button" onClick={addRow} className="w-full text-left px-2 py-1.5 text-xs text-primary hover:bg-accent/40 flex items-center gap-1"><Plus className="h-3.5 w-3.5" />Add task</button>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" name="tt-scope" checked={scope === 'personal'} onChange={() => setScope('personal')} />
                  <User className="h-3.5 w-3.5 text-muted-foreground" />Personal
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" name="tt-scope" checked={scope === 'team'} onChange={() => setScope('team')} />
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />Share with team
                </label>
              </div>
              {scope === 'team' && (
                <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="">— select a team —</option>
                  {teams.map((t) => <option key={t.teamid} value={t.teamid}>{t.name}</option>)}
                </select>
              )}
            </div>

            <DialogFooter className="sm:justify-between">
              <Button variant="ghost" size="sm" onClick={() => setMode('choose')}>Back</Button>
              <Button size="sm" disabled={create.isPending} onClick={() => void handleSaveNew()}>
                {create.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
                Save template
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TemplateGroup({
  title, icon: Icon, items, selectedId, onSelect, onDelete,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: ResolvedTemplate[];
  selectedId: string;
  onSelect: (id: string) => void;
  onDelete?: (t: ResolvedTemplate) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1 flex items-center gap-1"><Icon className="h-3 w-3" />{title}</p>
      <div className="space-y-1.5">
        {items.map((t) => {
          const milestones = t.tasks.filter((x) => x.isMilestone).length;
          return (
            <div key={t.id} className={cn('w-full flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors', selectedId === t.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30')}>
              <button onClick={() => onSelect(t.id)} className="flex-1 flex items-center justify-between text-left">
                <div>
                  <p className="text-sm font-medium text-foreground">{t.name}{t.teamName ? <span className="text-[11px] text-muted-foreground font-normal"> · {t.teamName}</span> : null}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{t.tasks.length} tasks · {milestones} milestones</p>
                </div>
                {selectedId === t.id && <ChevronRight className="h-4 w-4 text-primary shrink-0" />}
              </button>
              {onDelete && !t.isFallback && (
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => onDelete(t)} title="Delete template"><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
