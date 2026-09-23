import { useCallback } from 'react';
import { useCreateTelemetryEvent } from './useTelemetryEvents';
import { TELEMETRY_SEVERITY } from '../lib/constants';

interface AdminAuditParams {
  settingKey: string;
  oldValue: string | null;
  newValue: string;
}

export function useAdminAudit() {
  const create = useCreateTelemetryEvent();

  const audit = useCallback(
    ({ settingKey, oldValue, newValue }: AdminAuditParams) => {
      create.mutate({
        pmo_eventtype: 'AdminChange',
        pmo_severity: TELEMETRY_SEVERITY.Info,
        pmo_source: settingKey,
        pmo_payload: JSON.stringify({ settingKey, oldValue, newValue }),
      });
    },
    [create],
  );

  return audit;
}
