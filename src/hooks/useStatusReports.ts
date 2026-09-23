import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import {
  listStatusReports,
  getStatusReport,
  createStatusReport,
  updateStatusReport,
  deleteStatusReport,
  type StatusReportCreate,
  type StatusReportPayload,
} from '../api/statusReports.api';
import {
  listCustomStatusReports,
  getCustomStatusReport,
  createCustomStatusReport,
  updateCustomStatusReport,
  deleteCustomStatusReport,
} from '../api/customStatusReports.api';
import { useDataSource, usesCustomTables } from '../lib/taskSource';

// Source-versioned keys (like useProjects) so a data-source flip can't serve a
// cached list from the other side.
const KEYS = {
  all: (source: string) => ['statusReports', source] as const,
  forProject: (source: string, projectId: string) => ['statusReports', source, 'project', projectId] as const,
  detail: (source: string, id: string) => ['statusReports', source, 'detail', id] as const,
};

export function useStatusReports(projectId?: string) {
  const source = useDataSource();
  const custom = usesCustomTables(source);
  return useQuery({
    queryKey: projectId ? KEYS.forProject(source, projectId) : KEYS.all(source),
    queryFn: () =>
      custom ? listCustomStatusReports(projectId) : listStatusReports(projectId),
  });
}

export function useStatusReport(id: string | undefined) {
  const source = useDataSource();
  const custom = usesCustomTables(source);
  return useQuery({
    queryKey: KEYS.detail(source, id ?? ''),
    queryFn: () => (custom ? getCustomStatusReport(id!) : getStatusReport(id!)),
    enabled: !!id,
  });
}

export function useCreateStatusReport(projectId: string) {
  const qc = useQueryClient();
  const source = useDataSource();
  const custom = usesCustomTables(source);
  return useAppMutation({
    action: 'create status report',
    mutationFn: (payload: StatusReportCreate) =>
      custom ? createCustomStatusReport(projectId, payload) : createStatusReport(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['statusReports'] }),
  });
}

export function useUpdateStatusReport(_projectId: string) {
  const qc = useQueryClient();
  const source = useDataSource();
  const custom = usesCustomTables(source);
  return useAppMutation({
    action: 'update status report',
    mutationFn: ({ id, payload }: { id: string; payload: StatusReportPayload }) =>
      custom ? updateCustomStatusReport(id, payload) : updateStatusReport(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['statusReports'] }),
  });
}

export function useDeleteStatusReport(_projectId: string) {
  const qc = useQueryClient();
  const source = useDataSource();
  const custom = usesCustomTables(source);
  return useAppMutation({
    action: 'delete status report',
    mutationFn: (id: string) => (custom ? deleteCustomStatusReport(id) : deleteStatusReport(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['statusReports'] }),
  });
}
