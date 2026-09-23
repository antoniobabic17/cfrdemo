import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import { listPrograms, getProgram, createProgram, updateProgram } from '../api/programs.api';
import {
  listCustomPrograms,
  getCustomProgram,
  createCustomProgram,
  updateCustomProgram,
} from '../api/customPrograms.api';
import type { ProgramUpdate } from '../models/program.model';
import { useDataSource, usesCustomTables } from '../lib/taskSource';

// Source-versioned keys so a data-source flip can't serve the other side's cache.
const KEYS = {
  all: (source: string, extra: string[] = []) => ['programs', source, extra.join(',')] as const,
  detail: (source: string, id: string) => ['programs', source, 'detail', id] as const,
};

export function usePrograms(extraSelect: string[] = []) {
  const source = useDataSource();
  const custom = usesCustomTables(source);
  return useQuery({
    queryKey: KEYS.all(source, [...extraSelect].sort()),
    queryFn: () => (custom ? listCustomPrograms(extraSelect) : listPrograms(extraSelect)),
  });
}

export function useProgram(id: string | undefined) {
  const source = useDataSource();
  const custom = usesCustomTables(source);
  return useQuery({
    queryKey: KEYS.detail(source, id ?? ''),
    queryFn: () => (custom ? getCustomProgram(id!) : getProgram(id!)),
    enabled: !!id,
  });
}

export function useCreateProgram() {
  const qc = useQueryClient();
  const source = useDataSource();
  const custom = usesCustomTables(source);
  return useAppMutation({
    action: 'create program',
    mutationFn: (payload: object) =>
      custom ? createCustomProgram(payload as ProgramUpdate) : createProgram(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['programs'] });
    },
  });
}

export function useUpdateProgram(id: string) {
  const qc = useQueryClient();
  const source = useDataSource();
  const custom = usesCustomTables(source);
  return useAppMutation({
    action: 'update program',
    mutationFn: (payload: ProgramUpdate) =>
      custom ? updateCustomProgram(id, payload) : updateProgram(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['programs'] });
      qc.invalidateQueries({ queryKey: KEYS.detail(source, id) });
    },
  });
}
