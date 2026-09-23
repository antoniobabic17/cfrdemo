/**
 * Team bulletin hooks. Reads + writes against the annotation table via
 * api/teamBulletin.api.ts, plus an optimistic reaction toggle that bumps
 * the local cache before the server roundtrip finishes.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import {
  listTeamBulletin,
  createBulletinPost,
  updateBulletinPayload,
  deleteBulletinPost,
  type BulletinPost,
  type BulletinCreateInput,
} from '../api/teamBulletin.api';
import { toggleReaction } from '../lib/bulletinEnvelope';
import { useCurrentUserId } from './useCurrentUserId';

const QK = (teamId: string) => ['teamBulletin', teamId] as const;

// GUID-only sanity check so a routed param can't trigger a malformed OData query.
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useTeamBulletin(teamId: string | undefined) {
  return useQuery<BulletinPost[]>({
    queryKey: QK(teamId ?? ''),
    queryFn: () => listTeamBulletin(teamId!),
    enabled: !!teamId && GUID_RE.test(teamId),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function useCreateBulletinPost(teamId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'create bulletin post',
    mutationFn: (input: Omit<BulletinCreateInput, 'teamId'>) =>
      createBulletinPost({ ...input, teamId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK(teamId) });
    },
  });
}

export function useDeleteBulletinPost(teamId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'delete bulletin post',
    mutationFn: (annotationId: string) => deleteBulletinPost(annotationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK(teamId) });
    },
  });
}

/**
 * Optimistic reaction toggle — flips the user's reaction in the local
 * cache before the server PATCH finishes. The PATCH is fire-and-await on
 * the next tick; the cache is reconciled from the post-success refetch.
 *
 * Race trade-off: two users reacting in the same second can stomp on
 * each other's writes (last-writer-wins on the JSON blob). Acceptable
 * for v1; v2 could move reactions to per-(user, emoji) child rows.
 */
export function useToggleBulletinReaction(teamId: string) {
  const qc = useQueryClient();
  const userId = useCurrentUserId();

  return useAppMutation({
    action: 'toggle bulletin reaction',
    mutationFn: async ({
      post,
      emoji,
    }: { post: BulletinPost; emoji: string }) => {
      if (!userId) throw new Error('No current user — cannot react.');
      const next = toggleReaction(post.payload, emoji, userId.toLowerCase());
      await updateBulletinPayload(post.annotationId, next);
      return next;
    },
    onMutate: async ({ post, emoji }) => {
      if (!userId) return;
      await qc.cancelQueries({ queryKey: QK(teamId) });
      const prev = qc.getQueryData<BulletinPost[]>(QK(teamId));
      qc.setQueryData<BulletinPost[]>(QK(teamId), (old) =>
        (old ?? []).map((p) =>
          p.annotationId === post.annotationId
            ? { ...p, payload: toggleReaction(p.payload, emoji, userId.toLowerCase()) }
            : p,
        ),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(QK(teamId), ctx.prev);
    },
    onSettled: () => {
      // Defer reconcile so concurrent clicks don't fight; lets the
      // previous reconcile finish before the next refetch starts.
      setTimeout(() => qc.invalidateQueries({ queryKey: QK(teamId) }), 250);
    },
  });
}

/** Convenience: a flat-array → grouped-by-parent helper for the UI. */
export function groupBulletinByParent(posts: BulletinPost[]): {
  topLevel: BulletinPost[];
  repliesByParent: Map<string, BulletinPost[]>;
} {
  const topLevel: BulletinPost[] = [];
  const repliesByParent = new Map<string, BulletinPost[]>();
  for (const p of posts) {
    if (p.parentId) {
      const existing = repliesByParent.get(p.parentId) ?? [];
      existing.push(p);
      repliesByParent.set(p.parentId, existing);
    } else {
      topLevel.push(p);
    }
  }
  // Replies render oldest-first inside a thread; top-level is newest-first.
  for (const [k, list] of repliesByParent) {
    repliesByParent.set(
      k,
      list.slice().sort((a, b) =>
        new Date(a.createdOn).getTime() - new Date(b.createdOn).getTime(),
      ),
    );
  }
  return { topLevel, repliesByParent };
}

/** Returns true if the given user can post / reply / react on this team's
 *  bulletin: must be a member, OR be an admin. The hook layer above passes
 *  the membership + admin flags in. */
export function canPostToTeam(args: { isMember: boolean; isAdmin: boolean }): boolean {
  return args.isMember || args.isAdmin;
}

/** Returns true if the given user can delete a specific post. Authors can
 *  delete their own; team leads + admins can moderate any. */
export function canDeleteBulletinPost(args: {
  post: BulletinPost;
  currentUserId: string | null | undefined;
  canEditTeam: boolean;
}): boolean {
  if (args.canEditTeam) return true;
  if (!args.currentUserId) return false;
  return args.post.authorId === args.currentUserId.toLowerCase();
}
