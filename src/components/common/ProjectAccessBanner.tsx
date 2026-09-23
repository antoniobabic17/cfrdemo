/**
 * ProjectAccessBanner -- dismissible warning shown in the AppShell when
 * the current user's Project for the Web provisioning looks incomplete
 * (no license, disabled account, non-interactive access mode, or no
 * bookable resource despite being licensed).
 *
 * Silent when everything looks correct so the vast majority of users
 * never see it. Dismissal is per-tab (sessionStorage) so a warning
 * doesn't nag on every navigation but does return on next login.
 */
import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useCurrentUserProjectAccess } from '../../hooks/useCurrentUserProjectAccess';

const DISMISS_KEY = 'cfr.projectAccessBanner.dismissed';

export function ProjectAccessBanner() {
  const access = useCurrentUserProjectAccess();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  // Reset dismissal when the user's state improves — e.g. IT assigned a
  // license, they signed back in — so a later, unrelated warning isn't
  // suppressed by a stale dismissal. Adjusted during render (not in an
  // effect); the prior value is tracked in state rather than a ref since
  // react-hooks/refs (React Compiler) forbids ref access during render.
  const [prevHasWarning, setPrevHasWarning] = useState(access.hasWarning);
  if (prevHasWarning !== access.hasWarning) {
    setPrevHasWarning(access.hasWarning);
    if (!access.hasWarning && dismissed) setDismissed(false);
  }

  if (access.loading) return null;
  if (!access.hasWarning) return null;
  if (dismissed) return null;

  function handleDismiss() {
    setDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
  }

  return (
    <div className="shrink-0 flex items-start gap-2 px-6 py-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium">{access.message}</p>
        {access.hint && <p className="text-amber-700/90 dark:text-amber-400/90 mt-0.5">{access.hint}</p>}
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        className="shrink-0 text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
        aria-label="Dismiss"
        title="Dismiss for this session"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
