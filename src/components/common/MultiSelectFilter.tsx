/**
 * MultiSelectFilter — reusable checkbox-list filter chip.
 *
 * Extracted from components/data-table.tsx so galleries and other
 * non-DataTable list surfaces (HPI, Payer Inquiries) can reuse the same
 * multi-select filter UX the Projects table uses. `data-table.tsx`
 * continues to import and render it internally; keeping one implementation
 * ensures visual + behavior parity across every filterable list.
 */
import { useMemo, useState } from 'react';
import { Filter, ChevronDown, Check } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';

export interface MultiSelectFilterProps {
  header: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
}

export function MultiSelectFilter({ header, options, value, onChange }: MultiSelectFilterProps) {
  const [q, setQ] = useState('');
  const selectedSet = useMemo(() => new Set(value), [value]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [options, q]);

  const triggerLabel = useMemo(() => {
    if (value.length === 0) return `All ${header}`;
    if (value.length === 1) {
      return options.find((o) => o.value === value[0])?.label ?? `${header}: 1`;
    }
    return `${header}: ${value.length}`;
  }, [value, options, header]);

  function toggle(v: string) {
    if (selectedSet.has(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 h-8 px-3 text-xs rounded-md border bg-muted/50 border-border/60 text-foreground hover:bg-muted/70 transition-colors min-w-[140px]',
            value.length > 0 && 'border-primary/40 bg-primary/5',
          )}
        >
          <Filter className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="flex-1 text-left truncate">{triggerLabel}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="space-y-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${header.toLowerCase()}...`}
            className="h-8 text-xs"
          />
          <div className="max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border/60">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3 text-center">No matches.</p>
            ) : (
              filtered.map((o) => {
                const checked = selectedSet.has(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => toggle(o.value)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-muted/40"
                  >
                    <span
                      className={cn(
                        'h-4 w-4 rounded border flex items-center justify-center shrink-0',
                        checked ? 'bg-primary border-primary text-primary-foreground' : 'border-border',
                      )}
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="flex-1 truncate">{o.label}</span>
                  </button>
                );
              })
            )}
          </div>
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full text-xs text-muted-foreground hover:text-foreground py-1"
            >
              Clear selection
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
