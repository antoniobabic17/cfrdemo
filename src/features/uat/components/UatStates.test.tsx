/**
 * T057 — the three states, and the accessibility that makes them audible.
 *
 * **The order test is the one that matters.** A failed read usually leaves an empty array behind, so
 * a component that checks `isEmpty` before `isError` shows "no records" on every failure — the exact
 * defect T057 names, and one that is invisible in a demo because demos succeed. So the test drives
 * error and empty TOGETHER and asserts which wins.
 *
 * The roles are asserted rather than the classes: `role="alert"` is what makes a failure interrupt a
 * screen-reader user, and `role="status"` is what makes a change reach them without interrupting.
 * A styled `div` does neither, and looks identical.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UatLoading, UatError, UatEmpty, UatListState } from './UatStates';

describe('a failed load never claims the list is empty', () => {
  it('shows the ERROR when both error and empty are true', () => {
    // The realistic case: a rejected query leaves data undefined, so isEmpty is also true.
    render(
      <UatListState isPending={false} isError isEmpty what="test cases" emptyAction="Add one.">
        <div>rows</div>
      </UatListState>,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded/i);
    expect(screen.queryByText(/No test cases yet/i)).toBeNull();
    expect(screen.queryByText('rows')).toBeNull();
  });

  it('says the records still exist, so a reader retries instead of raising an incident', () => {
    render(<UatError what="test cases" />);
    expect(screen.getByRole('alert').textContent).toMatch(/They still exist/);
    expect(screen.getByRole('alert').textContent).toMatch(/not an empty list/);
  });

  it('offers a real button for the retry, reachable by keyboard', () => {
    const onRetry = vi.fn();
    render(<UatError what="test cases" onRetry={onRetry} />);
    const button = screen.getByRole('button', { name: /Try again/i });
    expect(button.tagName).toBe('BUTTON');
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the retry when the caller has nothing to retry with', () => {
    render(<UatError what="test cases" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('the three states are distinguishable', () => {
  it('loading says it is asking, and claims no answer', () => {
    render(<UatListState isPending isError={false} isEmpty what="requirements" emptyAction="Add one.">
      <div>rows</div>
    </UatListState>);
    expect(screen.getByRole('status').textContent).toMatch(/Loading requirements/i);
    expect(screen.queryByText('rows')).toBeNull();
  });

  it('empty says there is nothing AND what to do about it', () => {
    render(<UatListState isPending={false} isError={false} isEmpty what="defects" emptyAction="Raise one from a failing run.">
      <div>rows</div>
    </UatListState>);
    const status = screen.getByRole('status').textContent ?? '';
    expect(status).toMatch(/No defects yet/i);
    // An empty state with no next step is a dead end, so the action is a required prop.
    expect(status).toMatch(/Raise one from a failing run/);
  });

  it('renders the content when none of the three applies', () => {
    render(<UatListState isPending={false} isError={false} isEmpty={false} what="defects" emptyAction="Raise one.">
      <div>rows</div>
    </UatListState>);
    expect(screen.getByText('rows')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('accessibility is structural', () => {
  it('makes a failure an alert and a change a status', () => {
    const { unmount } = render(<UatError what="test cases" />);
    expect(screen.getByRole('alert')).toBeTruthy();
    unmount();

    render(<UatEmpty what="test cases" action="Add one." />);
    // status, not alert: an empty list is worth hearing, not worth interrupting for.
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('hides the decorative icons and leaves the meaning in the text', () => {
    render(<UatLoading what="cycles" />);
    const status = screen.getByRole('status');
    // The spinner must not be announced — "img" with no name is noise to a screen reader.
    expect(status.querySelector('[aria-hidden="true"]')).toBeTruthy();
    expect(status.textContent).toMatch(/Loading cycles/i);
  });

  it('capitalises the subject in the error sentence rather than reading "test cases could not"', () => {
    render(<UatError what="coverage links" />);
    expect(screen.getByRole('alert').textContent).toMatch(/^\s*Coverage links could not be loaded/);
  });
});

describe('every UAT surface distinguishes the three states', () => {
  /**
   * The scan that keeps this honest as surfaces are added. Every page that reads a list must
   * mention a read failure in a way that does not read as "nothing is here" — either by using this
   * component or by carrying the same distinction itself, which the Phase 4–11 pages do.
   */
  const pages = Object.fromEntries(
    Object.entries(
      import.meta.glob('../pages/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
    ).filter(([path]) => !/\.test\.tsx$/.test(path)),
  );

  it('scans the real pages', () => {
    expect(Object.keys(pages).length).toBeGreaterThan(6);
  });

  it('never pairs an isError branch with an empty-list message', () => {
    // The specific mistake: rendering "No records found" from the error branch. A page that HANDLES
    // isError itself must carry a read-failure sentence; a page that only FORWARDS it to a
    // component is exempt, because the component owns that state and has its own assertion —
    // TestCaseTable is the case, and T026 put the branch there deliberately so an error and an
    // empty list could not be confused on either of its two surfaces.
    //
    // This exemption was added because the scan flagged ProjectUatTab, which was correct code. A
    // guard that fires on correct delegation is a guard that gets deleted.
    for (const [path, source] of Object.entries(pages)) {
      const handlesItself = /if \(isError|\{isError &&|isError \?/.test(source);
      const forwardsOnly = /isError=\{/.test(source) && !handlesItself;
      if (!source.includes('isError') || forwardsOnly) continue;
      const saysReadFailure = /read failure|could not be loaded|still exist/i.test(source);
      expect(saysReadFailure, `${path} handles isError without saying it is a read failure`).toBe(true);
    }
  });

  it('is not vacuous: at least four pages handle isError themselves', () => {
    // The exemption above could swallow everything if every page merely forwarded. This counts
    // the pages the previous test actually checked.
    const handling = Object.entries(pages)
      .filter(([, source]) => /if \(isError|\{isError &&|isError \?/.test(source))
      .map(([path]) => path);
    expect(handling.length).toBeGreaterThanOrEqual(4);
  });
});
