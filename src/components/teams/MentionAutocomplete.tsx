/**
 * Floating autocomplete list for `@…` mention triggers in the bulletin
 * composer. Pure presentation — the composer owns the trigger detection,
 * member list, and inject-on-pick logic via mentionsParser.
 */
import { useEffect } from 'react';
import { cn } from '../../lib/utils';

export interface MentionCandidate {
  userId: string;
  name: string;
}

interface Props {
  candidates: MentionCandidate[];
  activeIndex: number;
  onPick: (candidate: MentionCandidate) => void;
  onActiveIndexChange: (index: number) => void;
}

/**
 * Keyboard handling lives in the composer itself (it needs the cursor
 * + textarea context). This component only renders the list; it forwards
 * mouse picks to onPick and re-emits hover-driven index changes.
 *
 * When candidates are empty, render null so the consumer can tree-shake
 * the surrounding popover frame.
 */
export function MentionAutocomplete({ candidates, activeIndex, onPick, onActiveIndexChange }: Props) {
  // Clamp the activeIndex if the candidate list shrinks below it.
  useEffect(() => {
    if (candidates.length === 0) return;
    if (activeIndex >= candidates.length) {
      onActiveIndexChange(candidates.length - 1);
    } else if (activeIndex < 0) {
      onActiveIndexChange(0);
    }
  }, [candidates.length, activeIndex, onActiveIndexChange]);

  if (candidates.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="Mention suggestions"
      className="z-50 max-h-56 w-64 overflow-y-auto rounded-md border border-border bg-popover shadow-md p-1"
    >
      {candidates.map((c, i) => (
        <button
          key={c.userId}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          onMouseEnter={() => onActiveIndexChange(i)}
          onClick={() => onPick(c)}
          className={cn(
            'flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm rounded',
            i === activeIndex
              ? 'bg-primary/10 text-primary'
              : 'text-foreground hover:bg-muted',
          )}
        >
          <span className="h-5 w-5 rounded-full bg-primary/20 text-[10px] font-semibold text-primary flex items-center justify-center shrink-0">
            {c.name.split(' ').slice(0, 2).map((p) => p[0] ?? '').join('').toUpperCase()}
          </span>
          <span className="truncate">{c.name}</span>
        </button>
      ))}
    </div>
  );
}
