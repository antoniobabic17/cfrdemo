/**
 * Submit progress store — Stage 6 of the task-write reliability work.
 *
 * Single source of truth for "the user is submitting a batch of changes to a
 * task right now". Drives:
 *   - The top-of-app SubmitProgressBar
 *   - The SubmitFailureRouter (auto-navigate back to the failing task on error)
 *   - Per-task draft persistence across the failure round-trip (so the user
 *     doesn't lose the other 7 fields if 1 fails)
 *   - "Return memory" so when the user fixes the failed field and re-submits
 *     successfully, we can route them back to wherever they were.
 *
 * PSS field updates are atomic — all changed task fields ride in ONE
 * OperationSet. So a typical Submit is one step ("Saving 4 changes:
 * Title, Priority, Due, Notes"). Non-PSS work that the panel might also
 * batch (new checklist items, label assignments, etc.) is appended as
 * additional steps that run sequentially after the field step.
 *
 * The store keeps batches at most one at a time. Submit is disabled in the
 * panel while a batch is active.
 */
import { useSyncExternalStore } from 'react';

export interface SubmitStep {
  /** Stable id for keying / failure attribution. */
  id: string;
  /** User-facing label shown in the bar (e.g. "Saving 4 changes: Title, Due"). */
  label: string;
  /**
   * Field keys this step covers. For the field-update step this is the full
   * list of changed ScheduleTaskUpdate keys; the panel uses it to drive
   * inline error highlighting on failure.
   */
  fields: readonly string[];
  /** The actual work — returns when the step has fully landed (PSS settled). */
  run: () => Promise<unknown>;
}

export type SubmitBatchStatus = 'running' | 'failed' | 'done';

export interface SubmitBatch {
  /** Stable batch id. */
  id: string;
  /** Project the failing task lives in (for auto-nav). */
  projectId: string;
  /** Task id (for auto-nav + draft re-hydration). */
  taskId: string;
  /** Task subject snapshot — shown in the bar / error message. */
  taskSubject: string;
  /** Steps in submission order. */
  steps: SubmitStep[];
  /** Index of the step currently in flight (or last finished if status !== running). */
  currentIndex: number;
  /** Status of the batch. */
  status: SubmitBatchStatus;
  /** Friendly error message when status === 'failed'. */
  errorMessage: string | null;
  /** Field keys that the failing step touched (for inline highlight). */
  failedFields: readonly string[];
  /**
   * Where the user was when they clicked Submit. After a failure, the user
   * is auto-navigated to the failing task; once they re-submit successfully,
   * they are returned to this location.
   */
  returnTo: string | null;
  /**
   * Per-task draft snapshot at submission time. Used to re-hydrate the panel
   * if we have to navigate the user back due to a failure.
   */
  draftSnapshot: TaskDraftSnapshot | null;
}

/** Minimal draft shape — matches the panel's local state keys. Plain JSON. */
export interface TaskDraftSnapshot {
  subject?: string;
  description?: string;
  priority?: number;
  isMilestone?: boolean;
  scheduledStart?: string;
  scheduledEnd?: string;
  effort?: number;
  effortCompleted?: number;
  /** Slider value (0-100). Stored separately because the panel converts to effortCompleted. */
  progress?: number;
}

interface QueuedBatch {
  input: StartSubmitInput;
  resolve: (status: SubmitBatchStatus) => void;
}

interface StoreState {
  active: SubmitBatch | null;
  /** FIFO queue of batches waiting to start. Submits while one is running
   *  no longer drop — they line up and run serially. */
  queue: QueuedBatch[];
  /** Drafts pinned per task — re-hydrated when the panel mounts after auto-nav. */
  pendingDrafts: Map<string, TaskDraftSnapshot>;
  /** When non-null, the panel should scroll to + highlight these field keys. */
  pendingHighlight: { taskId: string; fields: readonly string[]; message: string } | null;
}

const state: StoreState = {
  active: null,
  queue: [],
  pendingDrafts: new Map(),
  pendingHighlight: null,
};

const subscribers = new Set<() => void>();
let nextBatchId = 0;

function emit(): void {
  subscribers.forEach((fn) => fn());
}

// Cached snapshot for useSyncExternalStore — only rebuilt when state changes
// so React's identity check doesn't trigger spurious re-renders.
let cachedSnapshot: { active: SubmitBatch | null } = { active: null };
function rebuildSnapshot(): void {
  cachedSnapshot = { active: state.active };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface StartSubmitInput {
  projectId: string;
  taskId: string;
  taskSubject: string;
  steps: SubmitStep[];
  returnTo: string | null;
  draftSnapshot: TaskDraftSnapshot | null;
}

/**
 * Enqueue a submit batch. Returns a Promise that resolves with the final
 * status when the batch ends.
 *
 * Concurrent calls are queued FIFO and run serially — the user can hit
 * Submit on Task A, then Submit on Task B, and both will run in order
 * without losing the second one.
 */
export function startSubmit(input: StartSubmitInput): Promise<SubmitBatchStatus> {
  return new Promise<SubmitBatchStatus>((resolve) => {
    state.queue.push({ input, resolve });
    emit(); // notify subscribers that a new item entered the queue
    // Kick the drain if nothing is currently running.
    if (!state.active) {
      void runNextBatch();
    }
  });
}

/** Internal: pull the next batch off the queue and run it. */
async function runNextBatch(): Promise<void> {
  const queued = state.queue.shift();
  if (!queued) return;
  const { input, resolve } = queued;

  const batch: SubmitBatch = {
    id: `sb-${++nextBatchId}`,
    projectId: input.projectId,
    taskId: input.taskId,
    taskSubject: input.taskSubject,
    steps: input.steps,
    currentIndex: 0,
    status: 'running',
    errorMessage: null,
    failedFields: [],
    returnTo: input.returnTo,
    draftSnapshot: input.draftSnapshot,
  };
  state.active = batch;
  rebuildSnapshot();
  emit();

  let finalStatus: SubmitBatchStatus = 'done';
  for (let i = 0; i < batch.steps.length; i++) {
    batch.currentIndex = i;
    rebuildSnapshot();
    emit();
    try {
      await batch.steps[i].run();
    } catch (err) {
      batch.status = 'failed';
      batch.errorMessage = err instanceof Error ? err.message : String(err);
      batch.failedFields = batch.steps[i].fields;
      if (batch.draftSnapshot) {
        state.pendingDrafts.set(batch.taskId, batch.draftSnapshot);
      }
      state.pendingHighlight = {
        taskId: batch.taskId,
        fields: batch.failedFields,
        message: batch.errorMessage,
      };
      rebuildSnapshot();
      emit();
      finalStatus = 'failed';
      break;
    }
  }

  if (finalStatus === 'done') {
    batch.status = 'done';
    state.pendingDrafts.delete(batch.taskId);
    state.pendingHighlight = null;
    rebuildSnapshot();
    emit();
  }

  // Resolve this batch's promise BEFORE draining the next so callers see
  // their result in the same tick the bar transitions.
  resolve(finalStatus);

  // Hand off to the next queued batch (if any) immediately. We previously
  // relied on a useEffect in the bar to clearActiveBatch() on done, which
  // raced with this kickoff: the effect could null state.active between
  // batches, after which the next batch's running state never published
  // because subscribers had already settled. Now the queue runner owns the
  // transition: chain directly to the next batch on success, or clear the
  // active slot when the queue is empty.
  if (state.queue.length > 0) {
    // Don't null state.active here — runNextBatch will overwrite it.
    // Use a microtask so React renders the previous batch's terminal state
    // before flipping into the next one.
    void Promise.resolve().then(() => runNextBatch());
  } else if (finalStatus === 'done') {
    // Successful terminal: hide the bar after a short delay so the user can
    // see the success momentarily even though we're not flashing anymore.
    void Promise.resolve().then(() => {
      // Only clear if no new batch sneaked in during the microtask.
      if (state.queue.length === 0 && state.active?.id === batch.id) {
        state.active = null;
        rebuildSnapshot();
        emit();
      }
    });
  }
  // On 'failed': leave state.active set so the bar keeps showing the error
  // until SubmitFailureRouter completes the auto-nav. The next user action
  // (Submit again or close panel) will clear it via clearActiveBatch.
}

/** Clear the active batch (e.g. after the bar finishes its "Done" flash). */
export function clearActiveBatch(): void {
  if (state.active) {
    state.active = null;
    rebuildSnapshot();
    emit();
  }
}

/**
 * Consume the pending highlight for a task — returns it once and clears it.
 * Called by the panel when it mounts after auto-nav so the highlight only
 * fires once per failure.
 */
export function consumePendingHighlight(taskId: string): { fields: readonly string[]; message: string } | null {
  const h = state.pendingHighlight;
  if (h && h.taskId === taskId) {
    state.pendingHighlight = null;
    emit();
    return { fields: h.fields, message: h.message };
  }
  return null;
}

/** Read the persisted draft snapshot for a task (without consuming it). */
export function getPersistedDrafts(taskId: string): TaskDraftSnapshot | null {
  return state.pendingDrafts.get(taskId) ?? null;
}

/** Drop the persisted drafts for a task (called on Discard / Close / success). */
export function clearPersistedDrafts(taskId: string): void {
  if (state.pendingDrafts.delete(taskId)) {
    emit();
  }
}

// ── React hook ────────────────────────────────────────────────────────────────

function subscribe(listener: () => void): () => void {
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
}

function getSnapshot(): { active: SubmitBatch | null } {
  return cachedSnapshot;
}

/** Live snapshot of the active batch (or null). Re-renders on every state change. */
export function useSubmitProgress(): { active: SubmitBatch | null } {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ── Per-task pending-submit subscription ────────────────────────────
//
// Cards + the panel need to know "is THIS task in the submit pipeline right
// now?" so they can lock inputs and show a spinner while the task is either
// the active batch or sitting in the queue waiting its turn. The active
// SubmitProgressBar still reads only state.active so it always shows the
// task currently saving — not anything queued.

export type TaskSubmitState = 'idle' | 'queued' | 'active';

/** Compute the per-task state from the live store. */
function computeTaskSubmitState(taskId: string): TaskSubmitState {
  if (state.active && state.active.taskId === taskId && state.active.status === 'running') {
    return 'active';
  }
  for (const q of state.queue) {
    if (q.input.taskId === taskId) return 'queued';
  }
  return 'idle';
}

/**
 * React hook — returns 'active' | 'queued' | 'idle' for the given task.
 * Re-renders on any store change but the value only flips when this task's
 * pipeline status changes, so React's bail-out keeps unrelated cards stable.
 */
export function useTaskSubmitState(taskId: string | undefined | null): TaskSubmitState {
  return useSyncExternalStore(
    subscribe,
    () => taskId ? computeTaskSubmitState(taskId) : 'idle',
    () => 'idle',
  );
}

// ── Diagnostics ────────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  (window as unknown as { __submitProgressDebug?: () => unknown }).__submitProgressDebug = () => ({
    active: state.active,
    pendingDrafts: Object.fromEntries(state.pendingDrafts),
    pendingHighlight: state.pendingHighlight,
  });
}
