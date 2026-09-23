/**
 * Lightweight "save in flight" tracker for user-feedback rows.
 *
 * The admin detail page redirects back to the list as soon as updateUserFeedback
 * resolves, but the list query still needs a round-trip to refetch the row with
 * its new ownerid/status/etc. To bridge that gap the list row should appear
 * dimmed with a spinner — same UX as a queued task in the scheduling board —
 * until the refetch lands.
 *
 * Pattern lifted from failedSavesStore.ts: module-scope state, Set of
 * subscribers, useSyncExternalStore hook. No need for the per-task queue
 * machinery — saves here are single-shot OData PATCHes.
 */
import { useSyncExternalStore } from 'react';

let saving: ReadonlySet<string> = new Set();
const subscribers = new Set<() => void>();

function emit(): void {
  subscribers.forEach((fn) => fn());
}

/** Mark a feedback row as having an in-flight save. */
export function markFeedbackSaving(id: string): void {
  if (saving.has(id)) return;
  const next = new Set(saving);
  next.add(id);
  saving = next;
  emit();
}

/** Clear the in-flight marker — caller is responsible for invoking after the list refetch settles. */
export function clearFeedbackSaving(id: string): void {
  if (!saving.has(id)) return;
  const next = new Set(saving);
  next.delete(id);
  saving = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
}

/** React hook — full snapshot of in-flight feedback ids. Lookups in render. */
export function useFeedbackSavingSet(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => saving, () => saving);
}

/** React hook — true while id is in the saving set. */
export function useFeedbackSaving(id: string | undefined | null): boolean {
  const set = useFeedbackSavingSet();
  return !!id && set.has(id);
}
