import { useState, useRef, useCallback, useEffect } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';
import { ChevronDown, X, Loader2 } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (v: string) => void;
  /** Static options — used for small lists (teams, programs). Mutually exclusive with onSearch. */
  options?: SelectOption[];
  /** Server-side search callback — returns matching options. Used for large lists (users). */
  onSearch?: (query: string) => Promise<SelectOption[]>;
  /** Resolve the display label for the current value (when options aren't preloaded). */
  resolveLabel?: (value: string) => Promise<string>;
  placeholder?: string;
  disabled?: boolean;
  /** Minimum characters before triggering onSearch. Default 2. */
  minSearchLength?: number;
}

const MAX_VISIBLE = 50;
const DEBOUNCE_MS = 300;

export function SearchableSelect({
  value, onChange, options, onSearch, resolveLabel,
  placeholder = '— None —', disabled, minSearchLength = 2,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<SelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvedLabel, setResolvedLabel] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchIdRef = useRef(0);

  const isServerMode = !!onSearch;

  // Resolve display label for current value in server mode
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!value || !isServerMode || !resolveLabel) { setResolvedLabel(undefined); return; }
    let cancelled = false;
    resolveLabel(value).then((label) => { if (!cancelled) setResolvedLabel(label); });
    return () => { cancelled = true; };
  }, [value, isServerMode, resolveLabel]);

  const handleOpenAutoFocus = useCallback((e: Event) => {
    e.preventDefault();
    setSearch('');
    if (isServerMode) setResults([]);
    inputRef.current?.focus();
  }, [isServerMode]);

  // Server-side search with debounce
  useEffect(() => {
    if (!isServerMode || !open) return;
    if (search.trim().length < minSearchLength) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++searchIdRef.current;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await onSearch!(search.trim());
        if (id === searchIdRef.current) setResults(r.slice(0, MAX_VISIBLE));
      } finally {
        if (id === searchIdRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [search, open, isServerMode, onSearch, minSearchLength]);

  // Client-side filtering for static options
  const filtered = isServerMode ? results : (() => {
    if (!options) return [];
    if (!search.trim()) return options.slice(0, MAX_VISIBLE);
    const q = search.toLowerCase();
    const matches: SelectOption[] = [];
    for (const o of options) {
      if (o.label.toLowerCase().includes(q)) {
        matches.push(o);
        if (matches.length >= MAX_VISIBLE) break;
      }
    }
    return matches;
  })();

  const selectedLabel = isServerMode
    ? resolvedLabel
    : options?.find((o) => o.value === value)?.label;

  const showHint = isServerMode && search.trim().length < minSearchLength && !loading;
  const hasMore = !isServerMode && !search.trim() && (options?.length ?? 0) > MAX_VISIBLE;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring text-left flex items-center justify-between gap-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className={selectedLabel ? 'text-foreground truncate' : 'text-muted-foreground truncate'}>
            {selectedLabel ?? placeholder}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0"
        align="start"
        sideOffset={4}
        style={{ width: 'var(--radix-popover-trigger-width)' }}
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center border-b border-border px-3 py-2">
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isServerMode ? `Type ${minSearchLength}+ characters to search…` : 'Search…'}
            autoComplete="off"
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
          />
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-1" />}
          {search && !loading && (
            <button
              type="button"
              onClick={() => { setSearch(''); setResults([]); inputRef.current?.focus(); }}
              className="text-muted-foreground hover:text-foreground ml-1"
              tabIndex={-1}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="max-h-60 overflow-y-auto py-1">
          {value && (
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/60"
              onClick={() => { onChange(''); setOpen(false); }}
            >
              {placeholder}
            </button>
          )}
          {showHint && (
            <p className="px-3 py-2 text-sm text-muted-foreground">Type to search</p>
          )}
          {!showHint && !loading && filtered.length === 0 && search.trim().length >= minSearchLength && (
            <p className="px-3 py-2 text-sm text-muted-foreground">No matches</p>
          )}
          {filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              tabIndex={-1}
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-muted/60 ${o.value === value ? 'bg-primary/10 text-primary font-medium' : 'text-foreground'}`}
              onClick={() => {
                onChange(o.value);
                if (isServerMode) setResolvedLabel(o.label);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
          {hasMore && (
            <p className="px-3 py-1.5 text-xs text-muted-foreground border-t border-border mt-1 pt-1.5">
              Type to narrow — {(options?.length ?? 0).toLocaleString()} items total
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
