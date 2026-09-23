/**
 * SubmitFailureRouter — Stage 6 of the task-write reliability work.
 *
 * Originally listened to submitProgressStore and, when a batch transitioned to
 * 'failed', force-navigated the user back to the failing task panel so they
 * could fix the offending field and re-submit.
 *
 * DISABLED: the auto-nav was triggering even on transient PSS errors that the
 * user can't actually act on (PSS often throws on ExecuteOperationSetV1 even
 * though the create/update did persist), causing a stale task panel to
 * unexpectedly pop open after creating a different task. Failures are still
 * surfaced via the FailedSavesTray + global mutationCache toast, which is
 * enough — the user doesn't need to be teleported away from what they were
 * doing.
 *
 * Kept as a no-op component so the App.tsx mount point doesn't have to change.
 * Re-enable the body if/when we want auto-nav back.
 */
export function SubmitFailureRouter() {
  return null;
}
