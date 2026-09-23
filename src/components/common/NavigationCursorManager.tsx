import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Global wait-cursor during page navigations.
 *
 * Sets `cursor: wait` on `document.body` when the user clicks a nav link,
 * and clears it when the route actually changes (i.e. the page has loaded).
 *
 * Key fix vs the previous implementation: the fallback clear timer is now
 * 150 ms instead of 600 ms. The old 600 ms window was causing clicks to be
 * silently swallowed inside the Power Apps iframe host: `cursor: wait` on
 * the body suppresses pointer events, so any click within the 600 ms window
 * was eaten. Users experienced the sidebar as "needing 2–3 clicks to respond"
 * — each failed click just reset the 600 ms timer.
 *
 * 150 ms is long enough to give visual feedback that a navigation is starting
 * but short enough that a non-navigating click (tab switch, toggle, dropdown)
 * does not stay stuck and cannot swallow a follow-up click.
 *
 * Uses <HashRouter> + useLocation (component-based router) so it works with
 * this app's router setup. Note: useNavigation() requires a data router
 * (createHashRouter + RouterProvider) which this app does not use.
 */
export function NavigationCursorManager() {
  const location = useLocation();

  // Clear the wait cursor the moment the route changes — navigation complete.
  useEffect(() => {
    document.body.style.cursor = '';
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    let clearTimer: number | undefined;

    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      const interactive = target.closest('a, button, [role="button"]');
      if (!interactive) return;
      if (
        interactive.hasAttribute('disabled') ||
        interactive.getAttribute('aria-disabled') === 'true'
      ) return;

      document.body.style.cursor = 'wait';
      if (clearTimer) window.clearTimeout(clearTimer);
      // 150 ms fallback: long enough for visual feedback on a navigation,
      // short enough that a non-navigating click (toggle, tab switch, dialog)
      // doesn't block pointer events for any perceptible time.
      clearTimer = window.setTimeout(() => {
        document.body.style.cursor = '';
      }, 150);
    };

    document.addEventListener('click', onClick, { capture: true });
    return () => {
      document.removeEventListener('click', onClick, { capture: true });
      if (clearTimer) window.clearTimeout(clearTimer);
      document.body.style.cursor = '';
    };
  }, []);

  return null;
}
