import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import { listUserFeedback, createUserFeedback, updateUserFeedback } from '../api/userFeedback.api';
import type { UserFeedbackCreate } from '../models/userFeedback.model';
import { FEEDBACK_STATUS } from '../lib/constants';

const QK = ['userFeedback'] as const;
const listKey = (extra: string[] = []) => [...QK, 'list', extra.join(',')] as const;

export function useUserFeedback(extraSelect: string[] = []) {
  return useQuery({
    queryKey: listKey([...extraSelect].sort()),
    queryFn: () => listUserFeedback(extraSelect),
  });
}

export function useCreateUserFeedback() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'create user feedback',
    mutationFn: (payload: UserFeedbackCreate) => createUserFeedback(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}

export function useUpdateUserFeedback() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update user feedback',
    mutationFn: (params: { id: string; payload: Parameters<typeof updateUserFeedback>[1] }) =>
      updateUserFeedback(params.id, params.payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}

/** Count of feedback items still in the New (un-triaged) status. Drives the
 *  sidebar count bubble on the User Feedback nav item, mirroring the intake
 *  queue's actionable-count badge. */
export function useNewFeedbackCount(): number {
  const { data = [] } = useUserFeedback();
  return data.filter((f) => (f.pmo_status ?? null) === FEEDBACK_STATUS.New).length;
}
