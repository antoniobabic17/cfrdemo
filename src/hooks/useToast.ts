import { useState, useCallback } from 'react';
import { logAppError, type AppErrorContext } from '../lib/errorLog';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

let toastId = 0;

const listeners = new Set<(toast: Toast) => void>();

function emit(type: Toast['type'], message: string) {
  const toast: Toast = { id: String(++toastId), type, message };
  listeners.forEach((fn) => fn(toast));
}

/**
 * Global toast surface.
 *
 * `toast.error` and `toast.warning` also write one row to the Error Log
 * (pmo_telemetryevent with pmo_eventtype='AppError') so admins can diagnose
 * user-reported failures after the fact. Pass an optional AppErrorContext as
 * the second argument to enrich the log entry with `action` /
 * `entityType` / `entityId` / `parentProjectId` / `rawError` — otherwise the
 * log entry just captures the message plus the current route + user agent.
 * The success/info variants don't log.
 */
export const toast = {
  success: (message: string) => emit('success', message),
  error: (message: string, ctx?: Omit<AppErrorContext, 'message'>) => {
    emit('error', message);
    try { logAppError({ message, ...(ctx ?? {}) }); } catch { /* never let logging break the toast */ }
  },
  info: (message: string) => emit('info', message),
  warning: (message: string, ctx?: Omit<AppErrorContext, 'message'>) => {
    emit('warning', message);
    // Warnings are logged too so quota/degraded-experience toasts appear in
    // the log alongside hard errors. Uncomment guard here if noise becomes
    // an issue.
    try { logAppError({ message, ...(ctx ?? {}) }); } catch { /* swallow */ }
  },
};

export function useToastListener() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const subscribe = useCallback(() => {
    const handler = (t: Toast) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, 20_000);
    };
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, subscribe, dismiss };
}
