// getContext via the powerAppsContext wrapper (Patrick's host-hang fix: rejects
// after a 2s timeout instead of hanging forever when unhosted). The demo-mode
// fast-path below still short-circuits before even that 2s wait.
import { getContext } from './powerAppsContext';
import { isDemoActive } from './demoMode';

const PLAYER_BASE = 'https://apps.powerapps.com/play/e';

export interface DeepLinkState {
  page: string;
  id?: string;
  tab?: string;
  subtab?: string;
  task?: string;
  view?: string;
}

interface HostContext {
  environmentId: string;
  appId: string;
  tenantId: string;
}

let cachedHostContext: HostContext | null = null;
let initPromise: Promise<void> | null = null;

export async function initDeepLinkContext(): Promise<void> {
  if (initPromise) return initPromise;
  // Demo mode: never touch the Power Apps host bridge. getContext() only settles
  // when a Power Apps host replies over a MessageChannel port; on a static host
  // (Azure SWA/blob, vite preview, any non-PowerApps frame) it NEVER resolves or
  // rejects, so awaiting it would hang the ConfigurationProvider boot gate
  // (envResolved) forever on an infinite "Loading..." spinner. Short-circuit to
  // "no host context" so the app boots instantly with no backend.
  if (isDemoActive()) {
    cachedHostContext = null;
    initPromise = Promise.resolve();
    return initPromise;
  }
  initPromise = (async () => {
    try {
      const ctx = await getContext();
      cachedHostContext = {
        environmentId: ctx.app.environmentId,
        appId: ctx.app.appId,
        tenantId: ctx.user.tenantId ?? '',
      };
    } catch {
      cachedHostContext = null;
    }
  })();
  return initPromise;
}

export function isDeepLinkAvailable(): boolean {
  return cachedHostContext !== null;
}

export function getCachedEnvironmentId(): string | null {
  return cachedHostContext?.environmentId ?? null;
}

export function buildDeepLink(state: DeepLinkState): string | null {
  if (!cachedHostContext) return null;
  const { environmentId, appId, tenantId } = cachedHostContext;
  const base = `${PLAYER_BASE}/${environmentId}/app/${appId}`;
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', tenantId);
  if (state.page) params.set('page', state.page);
  if (state.id) params.set('id', state.id);
  if (state.tab && state.tab !== 'overview') params.set('tab', state.tab);
  if (state.subtab && state.subtab !== 'risks') params.set('subtab', state.subtab);
  if (state.task) params.set('task', state.task);
  if (state.view && state.view !== 'board') params.set('view', state.view);
  return `${base}?${params.toString()}`;
}

export async function readDeepLinkParams(): Promise<DeepLinkState | null> {
  // Demo mode: no host bridge (see initDeepLinkContext). Never call getContext().
  if (isDemoActive()) return null;
  try {
    const ctx = await getContext();
    const qp = ctx.app.queryParams;
    if (!qp.page) return null;
    return {
      page: qp.page,
      id: qp.id,
      tab: qp.tab,
      subtab: qp.subtab,
      task: qp.task,
      view: qp.view,
    };
  } catch {
    return null;
  }
}
