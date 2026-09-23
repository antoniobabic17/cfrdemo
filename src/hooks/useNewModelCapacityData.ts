/**
 * New Resource Model — portfolio capacity view. Sibling to useCapacityData
 * (which reads msdyn_resourceassignment / bookableresource for the Old
 * Resource Model), but reads pmo_taskassignment scoped to projects with
 * pmo_usenewresourcemodel = true, grouped by the direct systemuser identity
 * (_pmo_user_value) rather than the bookable-resource chain.
 *
 * Deliberately a SEPARATE hook/section — never blended with useCapacityData's
 * numbers, per the "two clearly-labeled sections, side by side" decision.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as dv from '../lib/dataverseClient';
import { useStandardCapacityHours } from './useAppSettings';

interface NewModelProjectRow {
  pmo_projectid: string;
  pmo_subject?: string | null;
}

interface NewModelAssignmentRow {
  pmo_taskassignmentid: string;
  _pmo_user_value?: string | null;
  '_pmo_user_value@OData.Community.Display.V1.FormattedValue'?: string;
  _pmo_projectref_value?: string | null;
  pmo_contributedhours?: number | null;
}

export interface NewModelCapacityEntry {
  userId: string;
  userName: string;
  totalContributedHours: number;
  projectCount: number;
  projectNames: string[];
  isOverallocated: boolean;
}

function useNewModelProjects() {
  return useQuery({
    queryKey: ['newModelCapacityProjects'],
    queryFn: () => dv.list<NewModelProjectRow>('pmo_projects', {
      $select: ['pmo_projectid', 'pmo_subject'],
      $filter: 'pmo_usenewresourcemodel eq true and statecode eq 0',
    }),
    staleTime: 5 * 60 * 1000,
  });
}

function useNewModelAssignments(projectIds: string[]) {
  return useQuery({
    queryKey: ['newModelCapacityAssignments', projectIds],
    queryFn: () => {
      if (projectIds.length === 0) return Promise.resolve([]);
      const filter = projectIds.map((id) => `_pmo_projectref_value eq '${id}'`).join(' or ');
      return dv.list<NewModelAssignmentRow>('pmo_taskassignments', {
        $select: ['pmo_taskassignmentid', '_pmo_user_value', '_pmo_projectref_value', 'pmo_contributedhours'],
        $filter: `(${filter}) and statecode eq 0`,
        $top: 5000,
      });
    },
    enabled: projectIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

export function useNewModelCapacityData() {
  const { data: projects = [], isLoading: projectsLoading } = useNewModelProjects();
  const projectIds = useMemo(() => projects.map((p) => p.pmo_projectid), [projects]);
  const { data: assignments = [], isLoading: assignmentsLoading } = useNewModelAssignments(projectIds);
  const capacityHours = useStandardCapacityHours();

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(p.pmo_projectid, p.pmo_subject ?? 'Untitled Project');
    return map;
  }, [projects]);

  const entries = useMemo((): NewModelCapacityEntry[] => {
    const byUser = new Map<string, {
      userName: string;
      totalContributedHours: number;
      projectIds: Set<string>;
    }>();

    for (const a of assignments) {
      const userId = a._pmo_user_value;
      if (!userId) continue;
      const bucket = byUser.get(userId) ?? {
        userName: a['_pmo_user_value@OData.Community.Display.V1.FormattedValue'] ?? '(unknown)',
        totalContributedHours: 0,
        projectIds: new Set<string>(),
      };
      bucket.totalContributedHours += a.pmo_contributedhours ?? 0;
      if (a._pmo_projectref_value) bucket.projectIds.add(a._pmo_projectref_value);
      byUser.set(userId, bucket);
    }

    return Array.from(byUser.entries())
      .map(([userId, b]) => ({
        userId,
        userName: b.userName,
        totalContributedHours: b.totalContributedHours,
        projectCount: b.projectIds.size,
        projectNames: Array.from(b.projectIds).map((id) => projectNameById.get(id) ?? 'Unknown Project'),
        isOverallocated: b.totalContributedHours > capacityHours,
      }))
      .sort((a, b) => b.totalContributedHours - a.totalContributedHours);
  }, [assignments, projectNameById, capacityHours]);

  const overallocatedCount = entries.filter((e) => e.isOverallocated).length;

  return {
    entries,
    capacityHours,
    overallocatedCount,
    totalUsers: entries.length,
    hasNewModelProjects: projects.length > 0,
    isLoading: projectsLoading || assignmentsLoading,
  };
}
