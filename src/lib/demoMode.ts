/**
 * Demo Mode activation — two ways in, one runtime signal.
 *
 *  1. Dedicated demo BUILD: `VITE_DEMO_MODE=1 npm run build` compiles
 *     `import.meta.env.VITE_DEMO_MODE` to the constant '1'. `isDemoBuild()` is
 *     then permanently true and the app is demo from first paint — the Power
 *     Apps SDK, connectors, Graph, SharePoint, and Mira are never touched. This
 *     bundle runs on ANY tenant/host (Power Platform, Azure, static file server)
 *     because it makes zero authenticated calls.
 *
 *  2. In-app TOGGLE on an already-set-up app: `setDemoMode(true)` flips a
 *     runtime flag (persisted to sessionStorage so a reload during a demo stays
 *     in demo mode — but note the DATA always re-seeds fresh from fixtures; only
 *     the on/off bit persists). The app must have booted against a real backend
 *     first, by definition.
 *
 * `isDemoModeActive()` (kept for back-compat with existing call sites) returns
 * true when EITHER path is active. New code may call the clearer `isDemoActive`.
 */

const STORAGE_KEY = 'cfr_demo_mode';

const subscribers = new Set<() => void>();
function emit() { subscribers.forEach((fn) => fn()); }

/** True only in a build produced with VITE_DEMO_MODE=1. Compile-time constant. */
export function isDemoBuild(): boolean {
  // import.meta.env values are inlined by Vite at build time; in a normal build
  // this is `undefined` and the whole demo path dead-code-eliminates.
  return import.meta.env.VITE_DEMO_MODE === '1' || import.meta.env.VITE_DEMO_MODE === 'true';
}

/** Runtime toggle state (sessionStorage), independent of the build flag. */
function runtimeToggleOn(): boolean {
  try { return sessionStorage.getItem(STORAGE_KEY) === 'true'; }
  catch { return false; }
}

/** Canonical signal: demo is active via the build flag OR the runtime toggle. */
export function isDemoActive(): boolean {
  return isDemoBuild() || runtimeToggleOn();
}

/** Back-compat alias used throughout the data layer. */
export function isDemoModeActive(): boolean {
  return isDemoActive();
}

export function setDemoMode(enabled: boolean): void {
  // In a demo build, the toggle is a no-op (demo is always on) — but we still
  // persist so the UI switch reflects an intentional value if ever shown.
  try {
    if (enabled) sessionStorage.setItem(STORAGE_KEY, 'true');
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* storage unavailable — build flag still governs */ }
  emit();
}

export function subscribeToDemoMode(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
