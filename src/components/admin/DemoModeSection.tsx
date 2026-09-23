import { useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Loader2, RotateCcw } from 'lucide-react';
import { isDemoModeActive, isDemoBuild, setDemoMode, subscribeToDemoMode } from '../../lib/demoMode';
import { resetDemoStore, DEMO_SETTINGS } from '../../lib/demoStore';
import { primeDataSourceCache } from '../../lib/taskSource';
import { primeFileSourceCache } from '../../lib/fileSource';
import { cn } from '../../lib/utils';

function useDemoMode() {
  return useSyncExternalStore(subscribeToDemoMode, isDemoModeActive);
}

/**
 * Give the in-memory seed + cache-clear a beat to complete behind a visible
 * overlay. The work itself is fast, but a deliberate short delay makes the
 * transition feel intentional (and covers React Query re-fetch churn) rather
 * than flickering. Operator explicitly OK'd a few-seconds loading screen here.
 */
const TRANSITION_MS = 1200;

export function DemoModeSection() {
  const active = useDemoMode();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<null | 'enabling' | 'disabling' | 'resetting'>(null);
  const buildLocked = isDemoBuild(); // a dedicated demo build can't be toggled off

  async function transition(fn: () => void, phase: 'enabling' | 'disabling' | 'resetting') {
    setBusy(phase);
    // Let the overlay paint before doing the (synchronous) work.
    await new Promise((r) => setTimeout(r, 50));
    fn();
    // A cache clear alone does NOT reliably refresh the whole app: the
    // ConfigurationProvider fetches app settings once with refetchOnMount:false
    // and resolves admin role / deep-link context in a one-time mount effect, so
    // toggling demo on/off left the Settings page (and other config-driven UI)
    // showing stale data until a manual reload. A full reload is the correct,
    // reliable refresh: the demo on/off bit is persisted to sessionStorage BEFORE
    // this runs, so it survives the reload; the store re-seeds fresh; every
    // provider, React Query cache, and module-level source cache re-initializes
    // cleanly against the new source. (Enabling/disabling only — 'resetting'
    // re-seeds in place and does not need a reload.)
    if (phase === 'resetting') {
      qc.clear();
      await new Promise((r) => setTimeout(r, TRANSITION_MS));
      setBusy(null);
      return;
    }
    // Keep the overlay visible; the reload replaces the page.
    window.location.reload();
  }

  function toggle() {
    if (buildLocked) return;
    if (active) transition(() => setDemoMode(false), 'disabling');
    else transition(() => {
      resetDemoStore();
      // Prime the data-source + file-source module caches synchronously so the
      // very first mutation after toggle uses 'custom'/'sharepoint' instead of
      // the 'pss'/'dataverse' defaults (which would trigger the 15s PSS delay
      // and broken upload path before the React Query settings fetch resolves).
      primeDataSourceCache(DEMO_SETTINGS);
      primeFileSourceCache(DEMO_SETTINGS);
      setDemoMode(true);
    }, 'enabling');
  }

  function reset() {
    transition(() => { resetDemoStore(); }, 'resetting');
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-foreground">Demo Mode</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Replace all live data with front-end-only sample data. Every add / edit / delete stays in
          your browser and is never written to Dataverse or SharePoint. Use when presenting the app
          to stakeholders without exposing real records. Reloading the page re-seeds fresh sample data.
        </p>
      </div>

      <div
        className={cn(
          'flex items-center justify-between rounded-lg border p-4 transition-colors',
          active ? 'border-amber-500/50 bg-amber-500/5' : 'border-border bg-card',
        )}
      >
        <div className="flex items-center gap-3">
          <FlaskConical className={cn('h-5 w-5 shrink-0', active ? 'text-amber-500' : 'text-muted-foreground')} />
          <div>
            <p className={cn('text-sm font-medium', active ? 'text-amber-600 dark:text-amber-400' : 'text-foreground')}>
              {active ? 'Demo Mode is ON' : 'Demo Mode is OFF'}
            </p>
            <p className="text-xs text-muted-foreground">
              {buildLocked
                ? 'This is a dedicated demo build — demo mode is always on and cannot be turned off.'
                : active
                  ? 'Showing sample data only. All writes are kept in-browser and discarded on reload.'
                  : 'Connected to the live environment.'}
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={active}
          onClick={toggle}
          disabled={!!busy || buildLocked}
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent',
            'transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2',
            'focus-visible:ring-ring focus-visible:ring-offset-2',
            buildLocked || busy ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
            active ? 'bg-amber-500' : 'bg-input',
          )}
        >
          <span
            className={cn(
              'pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg',
              'transform transition duration-200 ease-in-out',
              active ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </button>
      </div>

      {active && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
            Demo mode is stored per browser; other users are not affected.
          </p>
          <button
            type="button"
            onClick={reset}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40 disabled:opacity-60"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset demo data
          </button>
        </div>
      )}

      {/* Full-screen transition overlay */}
      {busy && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-lg border bg-card px-6 py-5 shadow-lg">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm font-medium text-foreground">
              {busy === 'enabling' ? 'Loading demo data…'
                : busy === 'disabling' ? 'Restoring live data…'
                : 'Resetting demo data…'}
            </p>
            <p className="text-xs text-muted-foreground max-w-xs text-center">
              {busy === 'disabling'
                ? 'Reconnecting to the live environment.'
                : 'Seeding sample records in your browser. Nothing is saved anywhere.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
