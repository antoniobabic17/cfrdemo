import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import {
  listCostLedgerItems,
  addCostLedgerItem,
  updateCostLedgerItem,
  removeCostLedgerItem,
  type CostLedgerInput,
} from '../api/costLedger.api';

const QK = (projectId: string) => ['costLedger', projectId] as const;

export function useCostLedgerItems(projectId: string | undefined) {
  return useQuery({
    queryKey: QK(projectId ?? ''),
    queryFn: () => listCostLedgerItems(projectId!),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAddCostLedgerItem(projectId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'add cost ledger item',
    mutationFn: (input: CostLedgerInput) => addCostLedgerItem(projectId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK(projectId) }),
  });
}

export function useUpdateCostLedgerItem(projectId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update cost ledger item',
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CostLedgerInput> }) =>
      updateCostLedgerItem(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK(projectId) }),
  });
}

export function useRemoveCostLedgerItem(projectId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'remove cost ledger item',
    mutationFn: (id: string) => removeCostLedgerItem(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK(projectId) }),
  });
}
