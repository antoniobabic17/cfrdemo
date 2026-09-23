import { useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface Props {
  /** Currently-selected option values. */
  value: string[];
  /** Fired whenever the selection changes. Receives the new array, never undefined. */
  onChange: (next: string[]) => void;
  /** Full option list. Filterable in the UI by typing in the search box. */
  options: MultiSelectOption[];
  /** Placeholder shown inside the search box. */
  placeholder?: string;
  /** Disable all interaction (read-only renderings). */
  disabled?: boolean;
}

/**
 * Multi-select control built from primitives we already ship (no Radix Popover
 * etc. needed). Selected items render as removable chips above an always-visible
 * filterable checkbox list. Small + dependency-free; suitable for short catalogs
 * (cr87a_systems has ~23 active rows in PROD, ~0 in DEV).
 */
export function MultiSelectCheckList({
  value, onChange, options, placeholder = 'Search...', disabled,
}: Props) {
  const [q, setQ] = useState('');

  const selectedSet = useMemo(() => new Set(value), [value]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [options, q]);

  function toggle(v: string) {
    if (disabled) return;
    if (selectedSet.has(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  }

  // Resolve labels for the chip row in the same order as the value array,
  // not options order, so the user sees their additions in the order made.
  const chips = value
    .map((v) => options.find((o) => o.value === v))
    .filter((o): o is MultiSelectOption => !!o);

  return (
    <div className="space-y-2">
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c.value}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs font-medium pl-2 pr-1 py-0.5"
            >
              {c.label}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => toggle(c.value)}
                  className="rounded-full p-0.5 hover:bg-primary/20"
                  aria-label={`Remove ${c.label}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
      <div className="max-h-48 overflow-y-auto rounded-md border border-border divide-y divide-border/60">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground p-3 text-center">No matches.</p>
        ) : filtered.map((o) => {
          const checked = selectedSet.has(o.value);
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => toggle(o.value)}
              disabled={disabled}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-muted/40',
                disabled && 'opacity-60 cursor-not-allowed hover:bg-transparent',
              )}
            >
              <span className={cn(
                'h-4 w-4 rounded border flex items-center justify-center shrink-0',
                checked ? 'bg-primary border-primary text-primary-foreground' : 'border-border',
              )}>
                {checked && <Check className="h-3 w-3" />}
              </span>
              <span className="flex-1">{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
