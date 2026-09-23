import { fmtDateOnly } from '../../lib/dateOnly';
/**
 * Single bulletin post (top-level or reply). Renders avatar + author +
 * timestamp + body (with mention chips) + optional GIF + reactions +
 * reply count + actions menu.
 */
import { useState } from 'react';
import { MessageSquare, MoreHorizontal, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../ui/dropdown-menu';
import { ReactionBar } from './ReactionBar';
import { renderBody } from '../../lib/mentionsParser';
import { cn } from '../../lib/utils';
import type { BulletinPost as BulletinPostShape } from '../../api/teamBulletin.api';

interface Props {
  post: BulletinPostShape;
  /** lower-cased current user GUID, or '' if unresolved. */
  currentUserId: string;
  canReact: boolean;
  canDelete: boolean;
  /** Number of replies on this post (top-level only — pass 0 for replies). */
  replyCount: number;
  /** True when the reply thread under this post is open. Ignored for replies. */
  threadOpen: boolean;
  onToggleThread: () => void;
  onReact: (emoji: string) => void;
  onDelete: () => void;
  /** When true, this post renders as a reply (slightly slimmer). */
  isReply?: boolean;
}

function initials(name: string): string {
  return name
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase() || '··';
}

function timeAgo(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.round((now - d) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return fmtDateOnly(iso);
}

export function BulletinPost({
  post, currentUserId, canReact, canDelete, replyCount, threadOpen,
  onToggleThread, onReact, onDelete, isReply,
}: Props) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div
      id={`post-${post.annotationId}`}
      className={cn(
        'flex items-start gap-3 px-3 py-3',
        isReply ? 'bg-muted/20' : 'bg-card',
      )}
    >
      <div className="h-8 w-8 rounded-full bg-blue-500 text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
        {initials(post.authorName)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium text-foreground truncate">{post.authorName}</span>
          <span className="text-[11px] text-muted-foreground">{timeAgo(post.createdOn)}</span>
          {post.modifiedOn && post.modifiedOn !== post.createdOn && (
            <span className="text-[10px] text-muted-foreground italic">(edited)</span>
          )}

          {canDelete && (
            <div className="ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="text-muted-foreground hover:text-foreground p-1 rounded"
                    aria-label="Post actions"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="text-xs">
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={(e) => {
                      e.preventDefault();
                      setConfirmingDelete(true);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {post.payload.body && (
          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed break-words">
            {renderBody(post.payload.body, ({ name, userId, key }) => (
              <span
                key={key}
                title={userId}
                className="inline-flex items-center rounded bg-primary/10 text-primary px-1 font-medium"
              >
                @{name}
              </span>
            ))}
          </p>
        )}

        {post.payload.gifUrl && (
          <img
            src={post.payload.gifUrl}
            alt="Posted GIF"
            loading="lazy"
            className="mt-1.5 max-h-64 rounded-md border border-border"
          />
        )}

        <div className="mt-2 flex items-center gap-3 flex-wrap">
          <ReactionBar
            reactions={post.payload.reactions}
            currentUserId={currentUserId}
            canReact={canReact}
            onToggle={onReact}
          />
          {!isReply && (
            <button
              type="button"
              onClick={onToggleThread}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              title={threadOpen ? 'Hide replies' : 'Show replies'}
            >
              <MessageSquare className="h-3 w-3" />
              {replyCount === 0 ? 'Reply' : `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
            </button>
          )}
        </div>

        {confirmingDelete && (
          <div className="mt-2 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs">
            <span className="text-destructive">Delete this post?</span>
            <button
              onClick={() => { onDelete(); setConfirmingDelete(false); }}
              className="ml-auto text-destructive font-medium hover:underline"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmingDelete(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
