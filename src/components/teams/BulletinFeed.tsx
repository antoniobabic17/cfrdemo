/**
 * Top-level container for the Bulletin tab. Owns the composer + post
 * list and orchestrates create / react / delete + mention notifications.
 *
 * Read access is open to anyone who lands on the page (admin or public);
 * write access is gated by team membership OR admin via canPostToTeam.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, MessagesSquare } from 'lucide-react';
import {
  useTeamBulletin,
  useCreateBulletinPost,
  useToggleBulletinReaction,
  useDeleteBulletinPost,
  groupBulletinByParent,
  canPostToTeam,
  canDeleteBulletinPost,
} from '../../hooks/useTeamBulletin';
import { useCurrentUserId } from '../../hooks/useCurrentUserId';
import { useCurrentUserTeams } from '../../hooks/useCurrentUserTeams';
import { useEffectiveAdminRole } from '../../providers/ConfigurationProvider';
import { useCreateNotification } from '../../hooks/useNotifications';
import { BulletinComposer } from './BulletinComposer';
import { BulletinPost } from './BulletinPost';
import { type MentionCandidate } from './MentionAutocomplete';
import * as dv from '../../lib/dataverseClient';
import { ENTITY_SETS } from '../../lib/constants';
import type { BulletinPayload } from '../../lib/bulletinEnvelope';
import { toast } from '../../hooks/useToast';
import { serializeError } from '../../lib/utils';

interface Props {
  teamId: string;
  teamName: string;
}

interface MemberRow {
  systemuserid: string;
  fullname: string;
}

function useTeamMemberCandidates(teamId: string) {
  return useQuery<MentionCandidate[]>({
    queryKey: ['teamMembers', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const rows = await dv.list<MemberRow>(ENTITY_SETS.systemUser, {
        $select: ['systemuserid', 'fullname'],
        $filter: `teammembership_association/any(t: t/teamid eq '${teamId}')`,
        $orderby: 'fullname asc',
      });
      return rows.map((r) => ({ userId: r.systemuserid, name: r.fullname }));
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function BulletinFeed({ teamId, teamName }: Props) {
  const adminRole = useEffectiveAdminRole();
  const isAdmin = adminRole !== 'none';
  const userTeams = useCurrentUserTeams();
  const currentUserId = useCurrentUserId();
  const lowerUserId = (currentUserId ?? '').toLowerCase();

  const isMember = !!userTeams && userTeams.has(teamId);
  const canEditTeam = isAdmin; // For delete moderation, admin counts; team
  // lead is folded in via canDeleteBulletinPost when caller passes the
  // useCanEditTeam result. Keeping this flag minimal here.
  const canPost = canPostToTeam({ isMember, isAdmin });

  const { data: posts = [], isLoading, error } = useTeamBulletin(teamId);
  const { data: members = [] } = useTeamMemberCandidates(teamId);
  const createMut = useCreateBulletinPost(teamId);
  const reactMut = useToggleBulletinReaction(teamId);
  const deleteMut = useDeleteBulletinPost(teamId);
  const notifyMut = useCreateNotification();

  const [openThreads, setOpenThreads] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => groupBulletinByParent(posts), [posts]);

  function fireMentionNotifications(payload: BulletinPayload, postId: string) {
    if (!currentUserId) return;
    const me = currentUserId.toLowerCase();
    const seen = new Set<string>();
    for (const m of payload.mentions) {
      const recipient = m.userId.toLowerCase();
      if (!recipient || recipient === me) continue;
      if (seen.has(recipient)) continue;
      seen.add(recipient);
      notifyMut.mutate({
        pmo_title: `Mentioned in ${teamName}`,
        pmo_body: 'You were mentioned in a team bulletin post.',
        pmo_category: 1,
        pmo_actionurl: `/teams/${teamId}?tab=bulletin#post-${postId}`,
        'pmo_TargetUser@odata.bind': `/systemusers(${m.userId})`,
      });
    }
  }

  async function handleCreate(payload: BulletinPayload, parentAnnotationId?: string) {
    try {
      const created = await createMut.mutateAsync({ payload, parentAnnotationId });
      fireMentionNotifications(payload, created.annotationId);
    } catch (err) {
      toast.error(`Couldn’t post: ${serializeError(err)}`);
    }
  }

  function handleToggleThread(postId: string) {
    setOpenThreads((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {canPost ? (
        <BulletinComposer
          members={members}
          onSubmit={(payload) => handleCreate(payload)}
          isPending={createMut.isPending}
        />
      ) : (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          Read-only — only members of <span className="font-medium text-foreground">{teamName}</span>
          {' '}(and admins) can post here.
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Couldn’t load the bulletin: {serializeError(error)}.
          {String(error).toLowerCase().includes('annotation') && (
            <span className="ml-1">If this is a fresh environment, an admin needs to enable Notes on the standard Team entity in Maker → Tables → Team → Properties.</span>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading bulletin…</span>
        </div>
      ) : grouped.topLevel.length === 0 ? (
        <div className="rounded-xl border border-border p-10 text-center">
          <MessagesSquare className="h-7 w-7 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm font-medium text-foreground">No posts yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            {canPost ? 'Be the first to share something with the team.' : 'When team members post here, you’ll see it.'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y overflow-hidden">
          {grouped.topLevel.map((post) => {
            const replies = grouped.repliesByParent.get(post.annotationId) ?? [];
            const open = openThreads.has(post.annotationId);
            return (
              <div key={post.annotationId}>
                <BulletinPost
                  post={post}
                  currentUserId={lowerUserId}
                  canReact={canPost}
                  canDelete={canDeleteBulletinPost({ post, currentUserId, canEditTeam })}
                  replyCount={replies.length}
                  threadOpen={open}
                  onToggleThread={() => handleToggleThread(post.annotationId)}
                  onReact={(emoji) => reactMut.mutate({ post, emoji })}
                  onDelete={() => deleteMut.mutate(post.annotationId)}
                />
                {open && (
                  <div className="bg-muted/10 pl-12 border-t border-border">
                    {replies.map((r) => (
                      <BulletinPost
                        key={r.annotationId}
                        post={r}
                        currentUserId={lowerUserId}
                        canReact={canPost}
                        canDelete={canDeleteBulletinPost({ post: r, currentUserId, canEditTeam })}
                        replyCount={0}
                        threadOpen={false}
                        onToggleThread={() => {}}
                        onReact={(emoji) => reactMut.mutate({ post: r, emoji })}
                        onDelete={() => deleteMut.mutate(r.annotationId)}
                        isReply
                      />
                    ))}
                    {canPost && (
                      <div className="px-3 py-3 border-t border-border bg-card">
                        <BulletinComposer
                          members={members}
                          compact
                          placeholder="Write a reply…"
                          onSubmit={(payload) => handleCreate(payload, post.annotationId)}
                          isPending={createMut.isPending}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
