import { getContext as getContextFromSdk } from '@microsoft/power-apps/app';
import type { IContext } from '@microsoft/power-apps/app';
import { withTimeout } from './withTimeout';

// getContext() from the Power Apps SDK never resolves or rejects when the app
// isn't hosted inside a real Power Apps player (e.g. `vite dev` opened directly
// in a browser tab, no iframe host): DefaultPowerAppsBridge.initialize() posts a
// handshake to window.parent and waits forever for a reply nothing ever sends.
// Every caller in this app already assumes an unhosted getContext() *rejects*
// ("getContext not available (dev mode)") and falls back accordingly — so race
// it against a short timeout to turn the hang into the rejection they expect.
// Much shorter than withTimeout's 60s CRUD default: this isn't a slow-but-alive
// remote call, it's "no host to answer at all."
const HOST_HANDSHAKE_TIMEOUT_MS = 2000;

export function getContext(): Promise<IContext> {
  return withTimeout(getContextFromSdk(), 'Power Apps host handshake', HOST_HANDSHAKE_TIMEOUT_MS);
}
