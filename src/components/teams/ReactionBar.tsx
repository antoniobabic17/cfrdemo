/**
 * Reaction chip row + "add reaction" trigger for a single bulletin post.
 * Reactions are stored on the post payload as `Record<emoji, userId[]>`.
 * The component is presentation-only — the parent owns the toggle
 * mutation.
 */
import { Plus } from 'lucide-react';
import { EmojiPickerPopover } from './EmojiPickerPopover';
import { cn } from '../../lib/utils';

interface Props {
  /** emoji → array of systemuserids who reacted. Shared shape between the
   *  bulletin payload and note reactions, so this bar serves both. */
  reactions: Record<string, string[]>;
  /** Lower-case current user systemuserid, or empty when unresolved. */
  currentUserId: string;
  canReact: boolean;
  onToggle: (emoji: string) => void;
}

export function ReactionBar({ reactions, currentUserId, canReact, onToggle }: Props) {
  const entries = Object.entries(reactions).filter(([, users]) => users.length > 0);

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {entries.map(([emoji, users]) => {
        const mine = users.some((u) => u.toLowerCase() === currentUserId);
        return (
          <button
            key={emoji}
            type="button"
            disabled={!canReact}
            onClick={() => onToggle(emoji)}
            title={mine ? 'Click to remove your reaction' : 'Click to add your reaction'}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
              mine
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border bg-muted/40 text-foreground hover:bg-muted',
              !canReact && 'opacity-60 cursor-not-allowed',
            )}
          >
            <span className="leading-none">{emoji}</span>
            <span className="font-medium tabular-nums">{users.length}</span>
          </button>
        );
      })}

      {canReact && (
        <EmojiPickerPopover
          onPick={onToggle}
          trigger={
            <button
              type="button"
              className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors"
              title="Add a reaction"
            >
              <Plus className="h-3 w-3" />
            </button>
          }
        />
      )}
    </div>
  );
}
