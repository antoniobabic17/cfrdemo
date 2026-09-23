/**
 * Emoji picker. Large curated multi-category set rendered in a scrollable
 * grid — no external dependency. Renders inside a Popover anchored to the
 * trigger button the caller passes in.
 *
 * EMOJI_PICKER is kept as a flat export for backward compatibility (it is the
 * full flattened list). EMOJI_CATEGORIES drives the grouped display.
 */
import { Smile } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';
import { cn } from '../../lib/utils';

/** Grouped, curated emoji set — mirrors the common Microsoft Teams picker
 *  categories without pulling in a multi-thousand-emoji dependency. */
export const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: 'Smileys & People',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '🙂', '🙃',
      '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋',
      '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐',
      '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔',
      '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶',
      '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁',
      '😮', '😯', '😲', '😳', '🥺', '😦', '😨', '😰', '😥', '😢',
      '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤',
      '😠', '😡', '🤬', '😈', '👿', '💀', '💩', '🤡', '👻', '👽',
    ],
  },
  {
    label: 'Gestures & Body',
    emojis: [
      '👍', '👎', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙',
      '👈', '👉', '👆', '👇', '☝️', '👏', '🙌', '👐', '🤲', '🤝',
      '🙏', '✍️', '💅', '🤳', '💪', '🦾', '👀', '👁️', '🫡', '🫢',
      '🫣', '🫰', '🫶',
    ],
  },
  {
    label: 'Hearts & Symbols',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💯', '💢',
      '💥', '💫', '💦', '💨', '✅', '❌', '⭕', '❗', '❓', '⚠️',
      '⭐', '🌟', '✨', '⚡', '🔥', '🎯', '🏆', '🥇', '🎖️', '🚩',
    ],
  },
  {
    label: 'Objects & Activities',
    emojis: [
      '🎉', '🎊', '🥂', '🍾', '🎈', '🎁', '🎂', '🍰', '☕', '🍕',
      '🚀', '💡', '📌', '📎', '📝', '📅', '📈', '📉', '📊', '💼',
      '💰', '💵', '🔒', '🔓', '🔑', '🔔', '📣', '📢', '💬', '👋',
      '🙈', '🐛', '🩹', '🛠️', '⚙️', '🧰', '✔️', '➡️', '⬆️', '⬇️',
    ],
  },
];

/** Flattened list — retained for backward compatibility with any callers that
 *  imported the original flat constant. */
export const EMOJI_PICKER: string[] = EMOJI_CATEGORIES.flatMap((c) => c.emojis);

interface Props {
  onPick: (emoji: string) => void;
  /** Optional render-prop for the trigger. Defaults to a small smile icon. */
  trigger?: React.ReactNode;
  /** Aria label for the default trigger; ignored when trigger is provided. */
  triggerLabel?: string;
  align?: 'start' | 'center' | 'end';
}

export function EmojiPickerPopover({
  onPick,
  trigger,
  triggerLabel = 'Add a reaction',
  align = 'start',
}: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label={triggerLabel}
            title={triggerLabel}
            className={cn(
              'inline-flex h-6 w-6 items-center justify-center rounded-full',
              'text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
            )}
          >
            <Smile className="h-3.5 w-3.5" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={6}
        className="w-auto p-2"
      >
        <div className="max-h-64 w-[16.5rem] overflow-y-auto pr-1 space-y-2">
          {EMOJI_CATEGORIES.map((cat) => (
            <div key={cat.label}>
              <p className="px-0.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground sticky top-0 bg-popover">
                {cat.label}
              </p>
              <div className="grid grid-cols-6 gap-1">
                {cat.emojis.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => onPick(e)}
                    className="h-8 w-8 rounded hover:bg-muted text-lg leading-none transition-colors"
                    aria-label={`React with ${e}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
