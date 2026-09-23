import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { setImpersonatingUser } from './lib/adminImpersonation'
import { isDemoBuild, isDemoActive } from './lib/demoMode'
import { DEMO_SETTINGS } from './lib/demoStore'
import { primeDataSourceCache } from './lib/taskSource'
import { primeFileSourceCache } from './lib/fileSource'
import { resetAllTeamImpersonation } from './features/teams/_shared/teamImpersonation'

// Defaults on every app boot:
//   - Admin "act as user" impersonation OFF (admins start as admins)
//   - Per-team "Acting as <team>" pills OFF (admins must opt back in)
// Demo mode is intentionally NOT reset here:
//   - In a demo BUILD (VITE_DEMO_MODE=1) it is always on via isDemoBuild().
//   - The in-app TOGGLE persists in sessionStorage so a reload mid-demo stays in
//     demo mode (the DATA still re-seeds fresh on reload — only the on/off bit
//     persists). Toggling off clears it. See lib/demoMode.ts.
setImpersonatingUser(false)
resetAllTeamImpersonation()

// Prime the data-source + file-source module caches from the demo fixtures so
// mutation hooks read 'custom'/'sharepoint' synchronously on the very first
// render — before the React Query settings fetch resolves and useEffect fires.
// Without this, bucket/task creates would route to the PSS staging path (~15s)
// or the annotation upload path (which never confirms in demo).
//
// Use isDemoActive() (build flag OR the sessionStorage runtime toggle), NOT just
// isDemoBuild(): the in-app Demo Mode toggle reloads the page, and on that reload
// demo is active via sessionStorage — the caches must be primed then too, or the
// first post-reload mutation regresses to the slow PSS path.
if (isDemoActive()) {
  // eslint-disable-next-line no-console
  console.info('[demo] Demo mode active — in-memory fixtures only; no backend calls.')
  primeDataSourceCache(DEMO_SETTINGS)
  primeFileSourceCache(DEMO_SETTINGS)
}

// Retained for the log message distinction; a dedicated demo BUILD is always-on.
if (isDemoBuild()) {
  // eslint-disable-next-line no-console
  console.info('[demo] Dedicated demo build (VITE_DEMO_MODE=1).')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
