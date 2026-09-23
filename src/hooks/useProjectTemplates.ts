import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import {
  listTemplates, createTemplate, updateTemplate, deactivateTemplate,
} from '../api/projectTemplates.api';
import type { ProjectTemplateCreate, ProjectTemplateUpdate } from '../models/projectTemplate.model';

const QK = ['projectTemplates'] as const;

export function useProjectTemplates() {
  return useQuery({
    queryKey: QK,
    queryFn: listTemplates,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'create template',
    mutationFn: (payload: ProjectTemplateCreate) => createTemplate(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update template',
    mutationFn: ({ id, payload }: { id: string; payload: ProjectTemplateUpdate }) =>
      updateTemplate(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}

export function useDeactivateTemplate() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'deactivate template',
    mutationFn: (id: string) => deactivateTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}
