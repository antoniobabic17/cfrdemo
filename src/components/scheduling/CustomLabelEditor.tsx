/**
 * Freeform per-task label editor for the CUSTOM source. Reads/writes the
 * pmo_task.pmo_tasklabel text field ("name:#color;name:#color") via
 * useSetCustomTaskLabels — a direct OData PATCH, no PSS, no shared label table.
 * Users invent their own labels (name + color). Each edit persists immediately.
 */
import { useState } from 'react';
import { Pencil, X, Plus, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  parseTaskLabels, addTaskLabel, removeTaskLabel, renameTaskLabel,
} from '../../lib/taskLabelText';
import { useSetCustomTaskLabels } from '../../hooks/useCustomTaskLabels';

const SWATCHES = [
  '#e11d48', '#f59e0b', '#eab308', '#22c55e', '#0ea5e9',
  '#6366f1', '#8b5cf6', '#ec4899', '#64748b', '#0f172a',
];

interface Props {
  projectId: string;
  taskId: string;
  labelText: string | undefined;
  canEdit: boolean;
  disabled?: boolean;
}

export function CustomLabelEditor({ projectId, taskId, labelText, canEdit, disabled }: Props) {
  const setLabels = useSetCustomTaskLabels(projectId);
  const labels = parseTaskLabels(labelText);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(SWATCHES[0]);
  const [renaming, setRenaming] = useState<string | null>(null); // by name
  const [renameDraft, setRenameDraft] = useState('');

  const busy = disabled || setLabels.isPending;

  const commit = (text: string) => setLabels.mutate({ taskId, labelText: text });

  const contrast = (hex: string): string => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return '#ffffff';
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    // relative luminance -> pick black/white for legibility
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#111827' : '#ffffff';
  };

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Labels</label>
      <div className="flex items-center gap-1.5 flex-wrap">
        {labels.map((l) => {
          if (renaming === l.name) {
            return (
              <span key={l.name} className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: l.color, color: contrast(l.color) }}>
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setRenaming(null); return; }
                    if (e.key === 'Enter') {
                      const nm = renameDraft.trim();
                      if (nm && nm !== l.name) commit(renameTaskLabel(labelText, l.name, nm));
                      setRenaming(null);
                    }
                  }}
                  onBlur={() => {
                    const nm = renameDraft.trim();
                    if (nm && nm !== l.name) commit(renameTaskLabel(labelText, l.name, nm));
                    setRenaming(null);
                  }}
                  className="bg-transparent outline-none border-b border-current w-20 text-[10px]"
                  style={{ color: contrast(l.color) }}
                />
                <button onClick={() => setRenaming(null)} className="hover:opacity-70" title="Done"><Check className="h-3 w-3" /></button>
              </span>
            );
          }
          return (
            <span key={l.name} className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: l.color, color: contrast(l.color) }}>
              {l.name}
              {canEdit && (
                <>
                  <button
                    disabled={busy}
                    onClick={() => { setRenameDraft(l.name); setRenaming(l.name); }}
                    className="hover:opacity-70 ml-0.5 disabled:opacity-40" title="Rename label"
                  ><Pencil className="h-3 w-3" /></button>
                  <button
                    disabled={busy}
                    onClick={() => commit(removeTaskLabel(labelText, l.name))}
                    className="hover:opacity-70 disabled:opacity-40" title="Remove label"
                  ><X className="h-3 w-3" /></button>
                </>
              )}
            </span>
          );
        })}

        {canEdit && !adding && (
          <button
            disabled={busy}
            onClick={() => { setNewName(''); setNewColor(SWATCHES[0]); setAdding(true); }}
            className="text-[10px] px-2 py-0.5 rounded-full border border-dashed border-border text-muted-foreground hover:border-primary hover:text-foreground transition-colors disabled:opacity-40"
          ><Plus className="h-3 w-3 inline -mt-0.5" /> Add label</button>
        )}
      </div>

      {adding && (
        <div className="flex items-center gap-2 flex-wrap rounded-md border border-border p-2 bg-muted/20">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setAdding(false);
              if (e.key === 'Enter' && newName.trim()) { commit(addTaskLabel(labelText, newName, newColor)); setAdding(false); }
            }}
            placeholder="Label name"
            className="text-xs bg-background border border-border rounded px-2 py-1 outline-none focus:border-primary w-32"
          />
          <div className="flex items-center gap-1">
            {SWATCHES.map((c) => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className={cn('h-4 w-4 rounded-full border', newColor === c ? 'ring-2 ring-offset-1 ring-primary' : 'border-border')}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
          <button
            disabled={!newName.trim() || busy}
            onClick={() => { commit(addTaskLabel(labelText, newName, newColor)); setAdding(false); }}
            className="text-[10px] font-semibold px-2 py-1 rounded bg-primary text-primary-foreground disabled:opacity-40"
          >Add</button>
          <button onClick={() => setAdding(false)} className="text-[10px] px-2 py-1 rounded border border-border">Cancel</button>
        </div>
      )}
    </div>
  );
}
