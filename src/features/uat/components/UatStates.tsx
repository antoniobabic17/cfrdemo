/**
 * UatStates — the three states every UAT list owes its reader, in one place.
 *
 * **A blank panel on a failed load is a defect, not a state.** T057 says so, and the reason is that
 * the three states a list can be in are not interchangeable:
 *
 *   - **loading** — we are asking. Say so, and do not imply an answer.
 *   - **error** — we asked and could not get an answer. The records still exist; a message that
 *     says "no records" here tells the reader their data is gone, which is a false claim about the
 *     world made by an application that simply could not reach the server.
 *   - **empty** — we asked, and the answer is nothing. This is the only one of the three where
 *     "there is nothing here" is true.
 *
 * Every UAT surface built in Phases 4–11 distinguishes them; this component exists so a twelfth
 * surface cannot get it wrong by accident, and so the wording is the same everywhere.
 *
 * **Accessibility is structural here, not decorative.** The error state is a `role="alert"` (a
 * failure the reader must be told about), the loading and empty states are `role="status"` (a
 * change they should hear about without interruption), the spinner is `aria-hidden` with the text
 * carrying the meaning, and the retry is a real `<button>` so it is reachable by keyboard and
 * announced as an action. A `div` with an onClick is none of those things.
 */
import type { ReactNode } from 'react';
import { Loader2, AlertCircle, Inbox } from 'lucide-react';
import { Button } from '../../../components/ui/button';

export interface UatLoadingProps {
  /** What is being loaded, lower-case: "test cases", "the batch". */
  what: string;
}

export function UatLoading({ what }: UatLoadingProps) {
  return (
    <p className="text-sm text-muted-foreground flex items-center gap-2" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading {what}…
    </p>
  );
}

export interface UatErrorProps {
  /** What could not be loaded, lower-case: "test cases", "the coverage links". */
  what: string;
  onRetry?: () => void;
  /** Extra sentence for a surface that needs one. Optional by design. */
  children?: ReactNode;
}

/**
 * The state most easily got wrong, so its wording is fixed here.
 *
 * "They still exist — this is a read failure" is not padding: it is the difference between a reader
 * retrying and a reader raising an incident about lost data.
 */
export function UatError({ what, onRetry, children }: UatErrorProps) {
  return (
    <div className="space-y-2" role="alert">
      <p className="text-sm text-destructive flex items-start gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
        <span>
          {what.charAt(0).toUpperCase() + what.slice(1)} could not be loaded. They still exist —
          this is a read failure, not an empty list.
        </span>
      </p>
      {children}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>
      )}
    </div>
  );
}

export interface UatEmptyProps {
  /** What there is none of: "test cases", "requirements". */
  what: string;
  /**
   * What the reader can do about it. Required, because an empty state that does not say what to do
   * next is a dead end — and every UAT surface has a next step.
   */
  action: string;
  children?: ReactNode;
}

export function UatEmpty({ what, action, children }: UatEmptyProps) {
  return (
    <div className="space-y-2" role="status">
      <p className="text-sm text-muted-foreground flex items-start gap-2">
        <Inbox className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
        <span>No {what} yet. {action}</span>
      </p>
      {children}
    </div>
  );
}

export interface UatListStateProps {
  isPending: boolean;
  isError: boolean;
  /** True when the read succeeded and returned nothing. */
  isEmpty: boolean;
  what: string;
  emptyAction: string;
  onRetry?: () => void;
  /** Rendered when none of the three states applies — the normal case. */
  children: ReactNode;
}

/**
 * All three states and the content, decided once.
 *
 * The order is deliberate and is the whole value of the component: **error is checked before
 * empty**. A failed read usually leaves an empty array behind, so a component that checks `isEmpty`
 * first shows "no records" on every failure — which is precisely the defect T057 names, and it is
 * invisible in a demo because demos succeed.
 */
export function UatListState({
  isPending, isError, isEmpty, what, emptyAction, onRetry, children,
}: UatListStateProps) {
  if (isPending) return <UatLoading what={what} />;
  if (isError) return <UatError what={what} onRetry={onRetry} />;
  if (isEmpty) return <UatEmpty what={what} action={emptyAction} />;
  return <>{children}</>;
}
