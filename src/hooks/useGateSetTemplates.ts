import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import {
  listGateSetTemplates, listIntakeWorkflows, listProjectGateSets, getGateSetTemplate,
  createGateSetTemplate, updateGateSetTemplate,
  listGateSetItems, createGateSetItem, updateGateSetItem, deleteGateSetItem,
} from '../api/gateSetTemplates.api';
import type { GateSetTemplateCreate, GateSetTemplateUpdate, GateSetItemCreate, GateSetItemUpdate } from '../models/gateSetTemplate.model';

const QK = ['gateSetTemplates'] as const;
const INTAKE_QK = ['intakeWorkflows'] as const;
const GATESET_QK = ['projectGateSets'] as const;
const ITEMS_QK = (gateSetId: string) => ['gateSetItems', gateSetId] as const;

export function useGateSetTemplates() {
  return useQuery({ queryKey: QK, queryFn: listGateSetTemplates, staleTime: 10 * 60 * 1000 });
}

export function useIntakeWorkflows() {
  return useQuery({ queryKey: INTAKE_QK, queryFn: listIntakeWorkflows, staleTime: 10 * 60 * 1000 });
}

export function useProjectGateSets() {
  return useQuery({ queryKey: GATESET_QK, queryFn: listProjectGateSets, staleTime: 10 * 60 * 1000 });
}

export function useIntakeWorkflow(id: string | undefined) {
  return useQuery({
    queryKey: ['intakeWorkflow', id],
    queryFn: () => getGateSetTemplate(id!),
    enabled: !!id,
    staleTime: 10 * 60 * 1000,
  });
}

export function useCreateGateSetTemplate() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'create gate set template',
    mutationFn: (payload: GateSetTemplateCreate) => createGateSetTemplate(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK });
      qc.invalidateQueries({ queryKey: INTAKE_QK });
      qc.invalidateQueries({ queryKey: GATESET_QK });
    },
  });
}

export function useUpdateGateSetTemplate() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update gate set template',
    mutationFn: ({ id, payload }: { id: string; payload: GateSetTemplateUpdate }) => updateGateSetTemplate(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK });
      qc.invalidateQueries({ queryKey: INTAKE_QK });
      qc.invalidateQueries({ queryKey: GATESET_QK });
    },
  });
}

export function useGateSetItems(gateSetId: string | undefined) {
  return useQuery({
    queryKey: ITEMS_QK(gateSetId ?? ''),
    queryFn: () => listGateSetItems(gateSetId!),
    enabled: !!gateSetId,
    staleTime: 10 * 60 * 1000,
  });
}

export function useCreateGateSetItem() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'create gate set item',
    mutationFn: (payload: GateSetItemCreate) => createGateSetItem(payload),
    onSuccess: (_data, variables) => {
      const gateSetId = variables['pmo_GateSet@odata.bind'].replace(/.*\(|\)/g, '');
      qc.invalidateQueries({ queryKey: ITEMS_QK(gateSetId) });
    },
  });
}

export function useUpdateGateSetItem() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update gate set item',
    mutationFn: (args: { id: string; payload: GateSetItemUpdate; gateSetId: string }) =>
      updateGateSetItem(args.id, args.payload),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ITEMS_QK(variables.gateSetId) });
    },
  });
}

export function useDeleteGateSetItem() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'delete gate set item',
    mutationFn: (args: { id: string; gateSetId: string }) => deleteGateSetItem(args.id),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ITEMS_QK(variables.gateSetId) });
    },
  });
}
