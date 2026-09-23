/**
 * GIF search popover backed by Tenor v2.
 *
 * Reads the API key from pmo_appsettings (`pmo.tenor_api_key`). When the
 * key is unset OR the fetch fails (corporate Zscaler blocks Tenor in many
 * envs) we render a friendly "GIFs unavailable" message instead of
 * spinning forever — and we do NOT retry alternate hosts. Per the
 * enterprise security guardrails, a blocked third-party endpoint is a
 * policy decision; trying alternates would constitute circumvention.
 */
import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, Search } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import { useAppSetting } from '../../hooks/useAppSettings';
import { SETTING_TENOR_API_KEY } from '../../lib/constants';

interface TenorResult {
  id: string;
  url: string;
  preview: string;
}

interface Props {
  onPick: (gifUrl: string) => void;
  triggerLabel?: string;
}

const TENOR_BASE = 'https://tenor.googleapis.com/v2/search';
const DEBOUNCE_MS = 350;

interface TenorRawItem {
  id: string;
  media_formats?: {
    gif?: { url?: string };
    tinygif?: { url?: string };
  };
}

export function GifPickerPopover({ onPick, triggerLabel = 'Add a GIF' }: Props) {
  const apiKey = useAppSetting(SETTING_TENOR_API_KEY);
  const hasKey = typeof apiKey === 'string' && apiKey.trim().length > 0;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TenorResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorState, setErrorState] = useState<'none' | 'no-key' | 'blocked'>(
    hasKey ? 'none' : 'no-key',
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the no-key state in sync if the appsetting resolves later.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setErrorState((prev) => {
      if (!hasKey) return 'no-key';
      // Don't flip 'blocked' back to 'none' — the env policy is sticky.
      return prev === 'blocked' ? 'blocked' : 'none';
    });
  }, [hasKey]);

  // Debounced search.
  useEffect(() => {
    if (!open || !hasKey || errorState === 'blocked') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const url = new URL(TENOR_BASE);
        url.searchParams.set('key', apiKey!);
        url.searchParams.set('q', query.trim());
        url.searchParams.set('limit', '18');
        url.searchParams.set('media_filter', 'gif,tinygif');
        url.searchParams.set('client_key', 'cfr-pmo-bulletin');
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(`Tenor returned ${res.status}`);
        const json = await res.json() as { results?: TenorRawItem[] };
        const items: TenorResult[] = (json.results ?? [])
          .map((r) => ({
            id: r.id,
            url: r.media_formats?.gif?.url ?? '',
            preview: r.media_formats?.tinygif?.url ?? r.media_formats?.gif?.url ?? '',
          }))
          .filter((r) => r.url);
        setResults(items);
      } catch (err) {
        // Single failure → mark blocked; do not retry. Per the enterprise
        // guardrails, a network failure on a third-party endpoint is a
        // policy block, not a transient error worth retrying.
        // eslint-disable-next-line no-console
        console.warn('[GifPicker] search failed; marking blocked:', err);
        setErrorState('blocked');
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, hasKey, apiKey, errorState]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          title={triggerLabel}
          className={cn(
            'inline-flex h-6 px-2 items-center gap-1 rounded text-[11px] font-medium',
            'text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
          )}
        >
          <ImageIcon className="h-3.5 w-3.5" />
          GIF
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-80 p-3">
        {errorState === 'no-key' ? (
          <p className="text-xs text-muted-foreground">
            GIFs aren’t configured for this environment. An admin can set{' '}
            <code className="font-mono text-[10px]">pmo.tenor_api_key</code> in Admin
            Settings to enable the picker.
          </p>
        ) : errorState === 'blocked' ? (
          <p className="text-xs text-muted-foreground">
            GIF search is unavailable in this environment (likely blocked by
            corporate network policy). Type your message without a GIF, or paste
            a public image URL into the body.
          </p>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search GIFs…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8 text-sm"
                autoFocus
              />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5 max-h-72 overflow-y-auto">
              {loading && (
                <div className="col-span-3 flex items-center justify-center py-4 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              )}
              {!loading && query.trim() && results.length === 0 && (
                <p className="col-span-3 text-xs text-muted-foreground py-2 text-center">
                  No matches.
                </p>
              )}
              {results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    onPick(r.url);
                    setOpen(false);
                  }}
                  className="aspect-square overflow-hidden rounded border border-border hover:border-primary transition-colors"
                >
                  {/* Tiny preview is sufficient for the grid; no need for the
                      full-resolution gif until the user picks. */}
                  <img
                    src={r.preview}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
