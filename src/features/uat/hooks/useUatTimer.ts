/**
 * How long a run actually took, measured rather than typed.
 *
 * THE LEGACY VERSION OF THIS NUMBER WAS HAND-ENTERED AND LOAD-BEARING. `cr87a_minutestotest`
 * was typed by the tester, and a flow then filtered on `cr87a_minutestotest gt 240` against
 * a hard-coded sentinel — a number nobody measured gating a process. FR-017 says duration
 * must be measured from the moment the run is opened and that a tester must not be required
 * to type one at all.
 *
 * PAUSES ARE EXCLUDED BY NOT BEING RECORDED, which is the whole design decision here. The
 * obvious shape — track total elapsed, track pause durations, subtract — has two failure
 * modes that produce a plausible wrong number: a pause whose end is never recorded
 * subtracts forever, and two overlapping pause records subtract twice. So this keeps a
 * ledger of the intervals during which the run was **active**, and the measured duration is
 * their sum. A pause is simply a gap between intervals. There is nothing to subtract, so
 * there is nothing to subtract wrongly (FR-018).
 *
 * AN INTERRUPTION IS A PAUSE THE TESTER DID NOT DECLARE. The ledger is persisted on every
 * tick with the current interval's end stamped at that tick, so a closed tab, a crash or a
 * reload leaves a ledger whose last interval already ends at the last moment the run was
 * observably active. Reopening appends a NEW interval; the interruption becomes a gap and is
 * excluded like any pause. The cost is bounded and stated: at most one tick — one second —
 * of active time is lost per interruption. The alternative, leaving the interval open and
 * closing it at reopen, would count an overnight interruption as eleven hours of testing.
 *
 * WHEN THERE IS NO LEDGER AT ALL, the measure is honestly unavailable: a different browser,
 * cleared site data, a tester who started the run on another machine. FR-020 says what to do
 * and this module supports exactly that — the wall-clock span from `pmo_startedon` is offered
 * as a PROPOSAL for the tester to accept or correct, is recorded as an override, is never
 * written silently, and never blocks the save. `isProposal` is how the form knows which of
 * the two it is holding, and it is deliberately not possible to save a proposal as though it
 * were measured.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

/** One span during which the run was actively being worked. Epoch milliseconds. */
export interface ActiveInterval {
  startedAt: number;
  /**
   * Always set, including for the interval in progress — it is re-stamped on every tick.
   * An interval that could be left open is an interruption counted as work.
   */
  endedAt: number;
}

export interface UatTimerLedger {
  runId: string;
  /** `pmo_startedon`, for the wall-clock fallback. ISO 8601. */
  startedOn: string;
  intervals: ActiveInterval[];
}

/** How often the ledger is re-stamped, and therefore the resolution lost per interruption. */
export const TICK_MS = 1000;

/**
 * How far `pmo_startedon` may be in the past, at the moment this session opens the run, for
 * the measure still to count as measured.
 *
 * Beyond it the run was demonstrably worked somewhere this browser cannot see, so there is
 * time nobody observed and FR-020's proposal applies. Below it the gap is just the round trip
 * that created the run row.
 */
export const PROPOSAL_MIN_UNOBSERVED_MS = 60_000;

/** localStorage key for one run's ledger. Namespaced with the app's `cfr_` convention. */
export function ledgerKey(runId: string): string {
  return `cfr_uat_run_ledger_${runId}`;
}

/** Sum of the ledger's active spans. Negative or reversed spans contribute nothing. */
export function sumActiveMs(intervals: readonly ActiveInterval[]): number {
  return intervals.reduce(
    (total, i) => total + Math.max(0, i.endedAt - i.startedAt),
    0,
  );
}

/**
 * Milliseconds to the integer that gets written to `pmo_minutes`.
 *
 * Rounds to the nearest minute, with a FLOOR OF ONE for any run that took any time at all.
 * The floor is not cosmetic: `pmo_minutes` is an int, and 0 would mean "no time was spent",
 * which is indistinguishable from "nothing was measured" — the exact ambiguity
 * `pmo_minutesoverridden` exists to remove. A two-minute test recorded as 0 also silently
 * deflates every pace and effort number built on this column.
 *
 * Exactly 0 ms returns 0, because a run with no active interval at all has genuinely not
 * been worked and inventing a minute for it would be the mirror-image lie.
 */
export function toRecordedMinutes(activeMs: number): number {
  if (activeMs <= 0) return 0;
  return Math.max(1, Math.round(activeMs / 60_000));
}

/** `1h 04m 09s`, `4m 09s`, `9s` — the measured detail FR-019 requires be retained. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

/**
 * The line kept in the run's comments when a tester overrides the measure.
 *
 * FR-019 requires the measured detail to be retained alongside the override, so that a
 * typed number never quietly replaces what was observed. Written as prose rather than JSON
 * because its reader is a person auditing an effort number, and it names the interval count
 * so a heavily-interrupted run is visible as one.
 */
export function describeMeasure(intervals: readonly ActiveInterval[]): string {
  const activeMs = sumActiveMs(intervals);
  const spans = intervals.length;
  if (spans === 0) return 'No measured activity was recorded for this run.';
  const gaps = spans - 1;
  const gapNote = gaps === 0
    ? 'in one unbroken span'
    : `across ${spans} spans, with ${gaps} ${gaps === 1 ? 'break' : 'breaks'} excluded`;
  return `Measured ${formatDuration(activeMs)} of active time ${gapNote}.`;
}

/**
 * Read a stored ledger, rejecting anything that is not one.
 *
 * localStorage is shared with every other tab and every past version of this app, so a
 * value under this key is untrusted input. A malformed ledger is treated as ABSENT rather
 * than repaired: absent has a defined, honest behaviour (FR-020's proposal), while a
 * half-repaired ledger would be written to `pmo_minutes` as though it were measured.
 */
export function readLedger(runId: string): UatTimerLedger | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(ledgerKey(runId));
  }
  catch {
    // Private mode, or storage disabled. Indistinguishable from absent, and treated so.
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<UatTimerLedger>;
    if (candidate.runId !== runId) return null;
    if (typeof candidate.startedOn !== 'string') return null;
    if (!Array.isArray(candidate.intervals)) return null;
    const intervals = candidate.intervals.filter(
      (i): i is ActiveInterval =>
        !!i && typeof i === 'object'
        && Number.isFinite((i as ActiveInterval).startedAt)
        && Number.isFinite((i as ActiveInterval).endedAt),
    );
    return { runId, startedOn: candidate.startedOn, intervals };
  }
  catch {
    return null;
  }
}

function writeLedger(ledger: UatTimerLedger): void {
  try {
    window.localStorage.setItem(ledgerKey(ledger.runId), JSON.stringify(ledger));
  }
  catch {
    // A full or disabled store must not break the run. The measure degrades to a
    // proposal on the next open, which is a defined outcome rather than a lost save.
  }
}

export function clearLedger(runId: string): void {
  try {
    window.localStorage.removeItem(ledgerKey(runId));
  }
  catch { /* nothing to do, and nothing to report to a tester. */ }
}

/**
 * Bring a stored ledger forward to a fresh session.
 *
 * The reconciliation, stated plainly: every stored interval is already closed, because the
 * running interval is re-stamped on each tick. So resuming does NOT extend the last
 * interval — it appends a new one starting now, and the interruption between them is a gap.
 * That is what makes an interruption cost nothing but the last tick, instead of counting
 * the whole absence as work.
 */
export function reconcileLedger(
  stored: UatTimerLedger | null,
  runId: string,
  startedOn: string,
  now: number,
): UatTimerLedger {
  if (!stored || stored.intervals.length === 0) {
    return { runId, startedOn, intervals: [{ startedAt: now, endedAt: now }] };
  }
  return {
    runId,
    // The stored value wins: it is what pmo_startedon was when the run was opened, and a
    // caller re-deriving it from a refetched row could pass a rounded or reformatted one.
    startedOn: stored.startedOn,
    intervals: [...stored.intervals, { startedAt: now, endedAt: now }],
  };
}

export interface UseUatTimerOptions {
  /**
   * The run being timed. REQUIRED and non-null.
   *
   * The hook holds one run's ledger for its whole lifetime, and the caller mounts it with
   * `key={runId}` so a different run is a different instance. That is what lets the ledger be
   * read, reconciled and written once in a lazy initializer instead of in an effect that
   * re-syncs state — the shape `react-hooks/set-state-in-effect` exists to push code towards,
   * and here it also removes the window in which a tick could see a half-opened ledger.
   */
  runId: string;
  /** `pmo_startedon` as Dataverse holds it. Backs the wall-clock proposal. */
  startedOn: string;
}

export interface UatTimerMeasure {
  /** Active milliseconds, or the wall-clock span when this is a proposal. */
  ms: number;
  /** What would be written to `pmo_minutes`. */
  minutes: number;
  /**
   * True when no ledger was recoverable and `ms` is a wall-clock span rather than a
   * measure. A proposal MUST be shown to the tester and recorded as an override (FR-020).
   */
  isProposal: boolean;
  /** The measured detail for the comments field. Empty for a proposal — there is none. */
  detail: string;
}

export interface UseUatTimerResult extends UatTimerMeasure {
  isRunning: boolean;
  pause: () => void;
  resume: () => void;
  /** Human-readable running display, e.g. `4m 09s`. */
  display: string;
}

/**
 * One run's timer state. The ledger, whether it is running, and whether the measure is a
 * proposal are ONE value, deliberately.
 *
 * They were separate — state plus refs — and that has a window in it. `resume()` has to
 * append a new interval AND mark the run running; a flag flipped immediately while the
 * appended interval arrives with the next commit lets a tick extend the PREVIOUS interval to
 * now, stretching it across the whole pause. Measured while writing the pause test: 90 seconds
 * of work recorded as 21m 30s. One value makes every transition atomic, so there is no
 * ordering to get right.
 */
interface TimerState {
  ledger: UatTimerLedger;
  running: boolean;
  /**
   * Set when this session did not observe the start of the run, with the instant to measure
   * the wall clock from. Decided ONCE, at open, and never recomputed.
   *
   * It has to be decided at open, and this is the second thing that was wrong here. The first
   * attempt compared the wall clock against the measured time on every render and called a
   * large difference "unobserved" — but that is exactly what a pause looks like. A run paused
   * for twenty minutes has a wall clock twenty minutes ahead of its measure, so a correctly
   * recorded 90-second run with one break reported 21m 30s AND flagged itself an override,
   * defeating FR-018 through the back door with a plausible-looking number. The real
   * discriminator is not the size of the gap, it is whether this browser ever saw the work.
   */
  proposalFrom: number | null;
}

/** Read storage, reconcile, persist, and decide once whether this is a measure or a proposal. */
function openTimer(runId: string, startedOn: string, openedAt: number): TimerState {
  const stored = readLedger(runId);
  const recovered = !!stored && stored.intervals.length > 0;
  const startedOnMs = Date.parse(stored?.startedOn ?? startedOn);
  const unobserved = Number.isNaN(startedOnMs) ? 0 : openedAt - startedOnMs;
  const ledger = reconcileLedger(stored, runId, startedOn, openedAt);
  writeLedger(ledger);
  return {
    ledger,
    running: true,
    proposalFrom: !recovered && unobserved >= PROPOSAL_MIN_UNOBSERVED_MS ? startedOnMs : null,
  };
}

/** The last moment the ledger observed, which is "now" as of the most recent tick. */
function lastObserved(ledger: UatTimerLedger): number {
  const last = ledger.intervals[ledger.intervals.length - 1];
  return last ? last.endedAt : 0;
}

/**
 * The run form's clock. Starts on mount — nobody types anything to begin timing (FR-017).
 *
 * Mount it with `key={runId}`: one instance per run, so the ledger is opened exactly once.
 */
export function useUatTimer({ runId, startedOn }: UseUatTimerOptions): UseUatTimerResult {
  const [state, setState] = useState<TimerState>(() => openTimer(runId, startedOn, Date.now()));

  /**
   * Re-stamp the running interval's end. One mechanism for both the display tick and the
   * durability write, so a persisted ledger can never lag the number on screen.
   *
   * Created once for the life of the instance. A dependency on the ledger would tear the
   * interval down and rebuild it on every tick, which is how a timer starts drifting.
   */
  useEffect(() => {
    const id = window.setInterval(() => {
      setState((current) => {
        if (!current.running || current.ledger.intervals.length === 0) return current;
        const intervals = [...current.ledger.intervals];
        const last = intervals[intervals.length - 1];
        intervals[intervals.length - 1] = { ...last, endedAt: Date.now() };
        const ledger = { ...current.ledger, intervals };
        writeLedger(ledger);
        return { ...current, ledger };
      });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const pause = useCallback(() => {
    setState((current) => ({ ...current, running: false }));
  }, []);

  const resume = useCallback(() => {
    setState((current) => {
      // The new interval and the running flag land together, so no tick can see one without
      // the other. The paused span is now a gap, never something to subtract.
      const at = Date.now();
      const ledger = {
        ...current.ledger,
        intervals: [...current.ledger.intervals, { startedAt: at, endedAt: at }],
      };
      writeLedger(ledger);
      return { ...current, ledger, running: true };
    });
  }, []);

  const measure = useMemo<UatTimerMeasure>(() => {
    const activeMs = sumActiveMs(state.ledger.intervals);

    // A proposal: the wall-clock span since the run was opened, offered for the tester to
    // accept or correct and recorded as an override (FR-020). Never written silently.
    // Measured from the ledger's own last observation rather than from a fresh clock read, so
    // this stays a pure function of state.
    if (state.proposalFrom !== null) {
      const wall = Math.max(activeMs, lastObserved(state.ledger) - state.proposalFrom);
      // No measured detail exists to keep beside the override, and inventing one would be
      // worse than having none.
      return { ms: wall, minutes: toRecordedMinutes(wall), isProposal: true, detail: '' };
    }

    return {
      ms: activeMs,
      minutes: toRecordedMinutes(activeMs),
      isProposal: false,
      detail: describeMeasure(state.ledger.intervals),
    };
  }, [state]);

  return {
    ...measure,
    isRunning: state.running,
    pause,
    resume,
    display: formatDuration(measure.ms),
  };
}
