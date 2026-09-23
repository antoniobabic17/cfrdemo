/**
 * T027's timing acceptance, item by item: interval summing, pause exclusion, rounding, the
 * one-minute floor, and ledger reconciliation after a simulated interruption.
 *
 * WHY THE PURE FUNCTIONS ARE TESTED SEPARATELY FROM THE HOOK. The arithmetic is the part
 * that decides an effort number a flow could gate on — the legacy equivalent was a
 * hand-typed field filtered at a hard-coded 240 — and it should be readable without a fake
 * clock in the way. The hook is then driven for the three things arithmetic cannot show:
 * that timing begins with nobody typing, that a pause becomes a gap in the ledger, and that
 * an interruption is reconciled rather than counted.
 *
 * THE INTERRUPTION TEST IS THE ONE THAT MATTERS. Every other case fails loudly if it is
 * wrong. This one fails by recording an overnight browser close as eleven hours of testing,
 * which looks like a real number and is only wrong to someone who knows the tester went
 * home. It is simulated the way it actually happens: a ledger left in storage by a session
 * that stopped mid-run, then a fresh mount much later.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  clearLedger,
  describeMeasure,
  formatDuration,
  ledgerKey,
  readLedger,
  reconcileLedger,
  sumActiveMs,
  toRecordedMinutes,
  useUatTimer,
  type ActiveInterval,
  type UatTimerLedger,
} from './useUatTimer';

const RUN_ID = '55555555-5555-5555-5555-555555555555';
const T0 = Date.parse('2026-08-31T09:00:00.000Z');
const MIN = 60_000;

const span = (fromMs: number, toMs: number): ActiveInterval => ({ startedAt: fromMs, endedAt: toMs });

function storeLedger(ledger: UatTimerLedger) {
  window.localStorage.setItem(ledgerKey(ledger.runId), JSON.stringify(ledger));
}

beforeEach(() => {
  window.localStorage.clear();
});

// ── Interval summing and pause exclusion ────────────────────────────────────

describe('sumActiveMs — pauses are excluded by not being recorded', () => {
  it('sums one span', () => {
    expect(sumActiveMs([span(T0, T0 + 5 * MIN)])).toBe(5 * MIN);
  });

  it('sums several spans and ignores the gaps between them entirely', () => {
    // 4 minutes worked, an hour's lunch, 6 minutes worked. The hour is not subtracted —
    // it was never added, which is why it cannot be subtracted twice or forever.
    const intervals = [
      span(T0, T0 + 4 * MIN),
      span(T0 + 64 * MIN, T0 + 70 * MIN),
    ];
    expect(sumActiveMs(intervals)).toBe(10 * MIN);
  });

  it('is unaffected by how long the gaps are', () => {
    const short = [span(T0, T0 + MIN), span(T0 + 2 * MIN, T0 + 3 * MIN)];
    const long = [span(T0, T0 + MIN), span(T0 + 900 * MIN, T0 + 901 * MIN)];
    expect(sumActiveMs(short)).toBe(sumActiveMs(long));
  });

  it('contributes nothing for a reversed or zero-length span, rather than a negative', () => {
    // A clock adjustment can produce one. Subtracting it would reduce a real measure.
    expect(sumActiveMs([span(T0, T0), span(T0 + 10 * MIN, T0 + 2 * MIN)])).toBe(0);
    expect(sumActiveMs([span(T0, T0 + 5 * MIN), span(T0 + 10 * MIN, T0)])).toBe(5 * MIN);
  });

  it('is zero for an empty ledger', () => {
    expect(sumActiveMs([])).toBe(0);
  });
});

// ── Rounding and the one-minute floor ───────────────────────────────────────

describe('toRecordedMinutes — rounding and the one-minute floor', () => {
  it('rounds to the nearest minute at the half', () => {
    expect(toRecordedMinutes(89 * 1000)).toBe(1);   // 1m29s
    expect(toRecordedMinutes(90 * 1000)).toBe(2);   // 1m30s
    expect(toRecordedMinutes(149 * 1000)).toBe(2);
    expect(toRecordedMinutes(150 * 1000)).toBe(3);
  });

  it('floors at one minute for any run that took any time at all', () => {
    // The floor is not cosmetic: 0 would mean "no time was spent", which is
    // indistinguishable from "nothing was measured" — the ambiguity
    // pmo_minutesoverridden exists to remove — and it deflates every pace number.
    expect(toRecordedMinutes(1)).toBe(1);
    expect(toRecordedMinutes(10 * 1000)).toBe(1);
    expect(toRecordedMinutes(29 * 1000)).toBe(1);
  });

  it('returns zero only for a run with no active time at all', () => {
    // The mirror-image lie would be inventing a minute for a run nobody worked.
    expect(toRecordedMinutes(0)).toBe(0);
    expect(toRecordedMinutes(-5)).toBe(0);
  });

  it('handles a long run without drifting', () => {
    expect(toRecordedMinutes(240 * MIN)).toBe(240);
    // 240 is the legacy flow's hard-coded sentinel. Off-by-one here would flip it.
    expect(toRecordedMinutes(239 * MIN + 31 * 1000)).toBe(240);
    expect(toRecordedMinutes(239 * MIN + 29 * 1000)).toBe(239);
  });
});

describe('formatDuration', () => {
  it('reads as a duration a person would say out loud', () => {
    expect(formatDuration(9 * 1000)).toBe('9s');
    expect(formatDuration(4 * MIN + 9 * 1000)).toBe('4m 09s');
    expect(formatDuration(64 * MIN + 9 * 1000)).toBe('1h 04m 09s');
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(-1)).toBe('0s');
  });
});

describe('describeMeasure — the detail FR-019 keeps beside an override', () => {
  it('names an unbroken span', () => {
    expect(describeMeasure([span(T0, T0 + 4 * MIN)]))
      .toBe('Measured 4m 00s of active time in one unbroken span.');
  });

  it('counts the excluded breaks, so a heavily-interrupted run is visible as one', () => {
    const text = describeMeasure([
      span(T0, T0 + 2 * MIN),
      span(T0 + 30 * MIN, T0 + 32 * MIN),
      span(T0 + 90 * MIN, T0 + 91 * MIN),
    ]);
    expect(text).toContain('5m 00s');
    expect(text).toContain('across 3 spans');
    expect(text).toContain('2 breaks excluded');
  });

  it('says so plainly when there is nothing measured', () => {
    expect(describeMeasure([])).toBe('No measured activity was recorded for this run.');
  });
});

// ── Ledger durability ───────────────────────────────────────────────────────

describe('readLedger — stored ledgers are untrusted input', () => {
  it('round-trips a real one', () => {
    const ledger: UatTimerLedger = {
      runId: RUN_ID,
      startedOn: '2026-08-31T09:00:00Z',
      intervals: [span(T0, T0 + MIN)],
    };
    storeLedger(ledger);
    expect(readLedger(RUN_ID)).toEqual(ledger);
  });

  it('treats a malformed value as ABSENT rather than repairing it', () => {
    // Absent has a defined honest behaviour — FR-020's proposal. A half-repaired ledger
    // would be written to pmo_minutes as though it had been measured.
    for (const bad of ['not json', 'null', '[]', '{"runId":"other"}', '{"runId":"' + RUN_ID + '"}']) {
      window.localStorage.setItem(ledgerKey(RUN_ID), bad);
      expect(readLedger(RUN_ID), `should reject: ${bad}`).toBeNull();
    }
  });

  it('refuses a ledger belonging to a different run', () => {
    storeLedger({ runId: 'another-run', startedOn: '2026-08-31T09:00:00Z', intervals: [] });
    window.localStorage.setItem(
      ledgerKey(RUN_ID),
      JSON.stringify({ runId: 'another-run', startedOn: '2026-08-31T09:00:00Z', intervals: [] }),
    );
    expect(readLedger(RUN_ID)).toBeNull();
  });

  it('drops individual malformed intervals but keeps the ledger', () => {
    window.localStorage.setItem(ledgerKey(RUN_ID), JSON.stringify({
      runId: RUN_ID,
      startedOn: '2026-08-31T09:00:00Z',
      intervals: [span(T0, T0 + MIN), { startedAt: 'x', endedAt: null }, null],
    }));
    expect(readLedger(RUN_ID)?.intervals).toEqual([span(T0, T0 + MIN)]);
  });

  it('clears cleanly', () => {
    storeLedger({ runId: RUN_ID, startedOn: '2026-08-31T09:00:00Z', intervals: [span(T0, T0 + MIN)] });
    clearLedger(RUN_ID);
    expect(readLedger(RUN_ID)).toBeNull();
  });
});

// ── Reconciliation after an interruption ────────────────────────────────────

describe('reconcileLedger — an interruption is a pause the tester did not declare', () => {
  it('appends a new interval rather than extending the stored one', () => {
    const stored: UatTimerLedger = {
      runId: RUN_ID,
      startedOn: '2026-08-31T09:00:00Z',
      // A session that stopped at 09:04 without saving.
      intervals: [span(T0, T0 + 4 * MIN)],
    };
    // Reopened the next morning.
    const reopenedAt = T0 + 24 * 60 * MIN;
    const next = reconcileLedger(stored, RUN_ID, '2026-08-31T09:00:00Z', reopenedAt);

    expect(next.intervals).toHaveLength(2);
    expect(next.intervals[0]).toEqual(span(T0, T0 + 4 * MIN));
    expect(next.intervals[1]).toEqual(span(reopenedAt, reopenedAt));
    // The claim: the overnight absence contributes nothing.
    expect(sumActiveMs(next.intervals)).toBe(4 * MIN);
    expect(toRecordedMinutes(sumActiveMs(next.intervals))).toBe(4);
  });

  it('starts a fresh ledger when there is nothing stored', () => {
    const next = reconcileLedger(null, RUN_ID, '2026-08-31T09:00:00Z', T0);
    expect(next).toEqual({
      runId: RUN_ID,
      startedOn: '2026-08-31T09:00:00Z',
      intervals: [span(T0, T0)],
    });
  });

  it('keeps the STORED startedOn, not the one passed in', () => {
    // The stored value is what pmo_startedon was when the run was opened; a caller
    // re-deriving it from a refetched row can pass a reformatted or rounded one, and the
    // wall-clock proposal is measured from it.
    const stored: UatTimerLedger = {
      runId: RUN_ID,
      startedOn: '2026-08-31T09:00:00.123Z',
      intervals: [span(T0, T0 + MIN)],
    };
    const next = reconcileLedger(stored, RUN_ID, '2026-08-31T09:00:00Z', T0 + 2 * MIN);
    expect(next.startedOn).toBe('2026-08-31T09:00:00.123Z');
  });

  it('treats a stored ledger with zero intervals as nothing stored', () => {
    const next = reconcileLedger(
      { runId: RUN_ID, startedOn: '2026-08-31T09:00:00Z', intervals: [] },
      RUN_ID, '2026-08-31T09:00:00Z', T0,
    );
    expect(next.intervals).toEqual([span(T0, T0)]);
  });
});

// ── The hook ────────────────────────────────────────────────────────────────


describe('useUatTimer', () => {
  // The clock is vitest's, not an injected function. The hook reads Date.now() directly —
  // production code carrying a test-only seam was the earlier shape, and removing it also
  // removed the ref-read-during-render that this repo's lint rules reject.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Let real time pass, ticks included. Advances Date.now as well as the interval. */
  async function advance(ms: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  }

  const open = (startedOn = new Date(T0).toISOString()) =>
    renderHook(() => useUatTimer({ runId: RUN_ID, startedOn }));

  it('starts timing on open, with nobody typing anything (FR-017)', async () => {
    const { result } = open();
    expect(result.current.isRunning).toBe(true);
    expect(result.current.ms).toBe(0);

    await advance(90 * 1000);
    expect(result.current.ms).toBe(90 * 1000);
    expect(result.current.minutes).toBe(2);
    expect(result.current.display).toBe('1m 30s');
  });

  it('persists the ledger as it ticks, so an interruption leaves a closed interval', async () => {
    const { result } = open();
    await advance(3 * 1000);

    const stored = readLedger(RUN_ID);
    expect(stored?.intervals).toHaveLength(1);
    // Already closed at the last tick — this is what makes reconciliation cheap.
    expect(stored?.intervals[0].endedAt).toBe(T0 + 3 * 1000);
    expect(result.current.ms).toBe(3 * 1000);
  });

  it('excludes a paused span from the measure (FR-018)', async () => {
    const { result } = open();

    await advance(60 * 1000);
    expect(result.current.ms).toBe(60 * 1000);

    act(() => result.current.pause());
    expect(result.current.isRunning).toBe(false);

    // Twenty minutes away from the desk. The clock moves; the measure must not.
    await advance(20 * MIN);
    expect(result.current.ms).toBe(60 * 1000);

    act(() => result.current.resume());
    await advance(30 * 1000);
    expect(result.current.ms).toBe(90 * 1000);
    expect(result.current.minutes).toBe(2);
    // Two spans, one break — and the detail says so, for the comments field.
    expect(result.current.detail).toContain('2 spans');
    expect(result.current.detail).toContain('1 break excluded');
  });

  it('reconciles an interrupted run instead of counting the absence as work', async () => {
    // A previous session worked four minutes and then the tab closed.
    storeLedger({
      runId: RUN_ID,
      startedOn: new Date(T0).toISOString(),
      intervals: [span(T0, T0 + 4 * MIN)],
    });
    // Reopened the next morning.
    vi.setSystemTime(T0 + 24 * 60 * MIN);

    const { result } = open();

    // NOT twenty-four hours and not eleven: four minutes, plus this session's own time.
    expect(result.current.minutes).toBe(4);
    expect(result.current.isProposal).toBe(false);
    await advance(60 * 1000);
    expect(result.current.ms).toBe(5 * MIN);
  });

  it('proposes the wall clock, marked as a proposal, when no ledger survives (FR-020)', async () => {
    // No stored ledger — different browser, cleared site data, started elsewhere — and a
    // pmo_startedon two hours ago.
    vi.setSystemTime(T0 + 120 * MIN);
    const { result } = open(new Date(T0).toISOString());

    expect(result.current.isProposal).toBe(true);
    expect(result.current.minutes).toBe(120);
    // No measured detail exists to keep, and inventing one would be the worst outcome.
    expect(result.current.detail).toBe('');
  });

  it('does NOT turn a long PAUSE into a proposal — the bug this test was written to find', async () => {
    // A pause and unobserved time look identical to a wall-clock comparison: both leave the
    // clock far ahead of the measure. The first implementation compared the two on every
    // render and called the difference unobserved, so a correctly-recorded 90-second run with
    // one twenty-minute break reported 21m 30s AND flagged itself an override — defeating
    // FR-018 through the back door, with a plausible-looking number.
    const { result } = open();

    await advance(60 * 1000);
    act(() => result.current.pause());
    await advance(45 * MIN);
    act(() => result.current.resume());
    await advance(30 * 1000);

    expect(result.current.isProposal, 'a pause this session observed is not unobserved time').toBe(false);
    expect(result.current.ms).toBe(90 * 1000);
    expect(result.current.minutes).toBe(2);
    // And the measured detail survives, which an override would have had none of.
    expect(result.current.detail).toContain('1m 30s');
  });

  it('does NOT call a freshly-opened run a proposal', async () => {
    // pmo_startedon is now, so there is no unobserved time and nothing to propose.
    const { result } = open();
    await advance(30 * 1000);
    expect(result.current.isProposal).toBe(false);
    expect(result.current.minutes).toBe(1);
  });

  it('opens the ledger exactly once per instance, which is why the caller keys on the run', async () => {
    // The contract TestRunForm relies on: re-rendering must not re-open or reconcile. A second
    // open would append a second interval and, worse, could re-decide the proposal question.
    const { result, rerender } = open();
    await advance(5 * 1000);
    rerender();
    rerender();
    expect(readLedger(RUN_ID)?.intervals).toHaveLength(1);
    expect(result.current.ms).toBe(5 * 1000);
  });
});
