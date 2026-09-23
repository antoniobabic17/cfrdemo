import { useSearchParams } from 'react-router-dom';
import { useCallback } from 'react';

export const PROJECT_TABS = ['overview', 'plan', 'tasks', 'hpi', 'payerIssues', 'coding', 'monitor', 'govern', 'collaborate', 'status', 'notes', 'activity', 'uat'] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

export const MONITOR_SUB_TABS = ['risks', 'issues', 'changes', 'decisions'] as const;
export type MonitorSubTab = (typeof MONITOR_SUB_TABS)[number];

export const TASK_VIEWS = ['board', 'list', 'timeline', 'charts', 'people'] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export const TEAM_TABS = ['bulletin', 'announcement', 'scheduling', 'toggles', 'members'] as const;
export type TeamTab = (typeof TEAM_TABS)[number];

export function useUrlState<T extends string>(
  key: string,
  defaultValue: T,
  allowedValues?: readonly T[],
): [T, (value: T | null, options?: { replace?: boolean }) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const raw = searchParams.get(key);
  const value: T =
    raw !== null && (!allowedValues || (allowedValues as readonly string[]).includes(raw))
      ? (raw as T)
      : defaultValue;

  const setValue = useCallback(
    (next: T | null, options?: { replace?: boolean }) => {
      setSearchParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          if (next === null || next === defaultValue) {
            updated.delete(key);
          } else {
            updated.set(key, next);
          }
          return updated;
        },
        { replace: options?.replace ?? true },
      );
    },
    [key, defaultValue, setSearchParams],
  );

  return [value, setValue];
}
