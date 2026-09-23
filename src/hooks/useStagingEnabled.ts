/**
 * Feature flag: is the pmo_taskstaging write path enabled in this environment?
 *
 * Backed by pmo_appsetting.pmo.staging_enabled = 'true' | 'false'.
 *
 * Default false — the legacy direct-PSS path (schedulingClient.ts) is used
 * unless the flag is explicitly flipped on. This lets the solution ship to any
 * env without behavior change and lets DEV admins A/B test without a code
 * change if the plugin misbehaves.
 */
import { useAppSetting } from './useAppSettings';
import { SETTING_STAGING_ENABLED } from '../lib/constants';

export function useStagingEnabled(): boolean {
  const raw = useAppSetting(SETTING_STAGING_ENABLED);
  return (raw ?? '').trim().toLowerCase() === 'true';
}
