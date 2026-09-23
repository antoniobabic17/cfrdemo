import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';

interface AssignmentRow {
  msdyn_resourceassignmentid: string;
  msdyn_plannedwork?: number;
  '_msdyn_bookableresourceid_value'?: string;
  '_msdyn_projectid_value'?: string;
  '_msdyn_projectid_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_msdyn_taskid_value'?: string;
}

interface ResourceRow {
  bookableresourceid: string;
  name: string;
  '_userid_value'?: string;
}

export interface CapacityEntry {
  resourceId: string;
  resourceName: string;
  totalPlannedHours: number;
  projectCount: number;
  projects: { projectId: string; hours: number }[];
  projectNames: string[];
  isOverallocated: boolean;
}

export interface CapacityRecommendation {
  resourceId: string;
  resourceName: string;
  type: 'overloaded' | 'underutilized';
  totalHours: number;
  suggestion: string;
}

const STANDARD_CAPACITY_HOURS = 160;

function useAllAssignments() {
  return useQuery({
    queryKey: ['capacityAssignments'],
    queryFn: () => dv.list<AssignmentRow>(ENTITY_SETS.resourceAssignment, {
      $select: ['msdyn_resourceassignmentid', 'msdyn_plannedwork', '_msdyn_bookableresourceid_value', '_msdyn_projectid_value', '_msdyn_taskid_value'],
      $filter: 'statecode eq 0',
    }),
    staleTime: 5 * 60 * 1000,
  });
}

function useAllResources() {
  return useQuery({
    queryKey: ['capacityResources'],
    queryFn: () => dv.list<ResourceRow>(ENTITY_SETS.bookableResource, {
      $select: ['bookableresourceid', 'name', '_userid_value'],
      $filter: 'statecode eq 0',
    }),
    staleTime: 10 * 60 * 1000,
  });
}

export function useCapacityData() {
  const { data: assignments = [], isLoading: loadingA } = useAllAssignments();
  const { data: resources = [], isLoading: loadingR } = useAllResources();

  const entries: CapacityEntry[] = useMemo(() => {
    const byResource = new Map<string, { hours: number; projects: Map<string, number> }>();
    const projectNameMap = new Map<string, string>();

    for (const a of assignments) {
      const resId = a['_msdyn_bookableresourceid_value'];
      const projId = a['_msdyn_projectid_value'];
      if (!resId) continue;
      const hours = (a.msdyn_plannedwork ?? 0) / 60;
      let entry = byResource.get(resId);
      if (!entry) { entry = { hours: 0, projects: new Map() }; byResource.set(resId, entry); }
      entry.hours += hours;
      if (projId) {
        entry.projects.set(projId, (entry.projects.get(projId) ?? 0) + hours);
        const name = a['_msdyn_projectid_value@OData.Community.Display.V1.FormattedValue'];
        if (name) projectNameMap.set(projId, name);
      }
    }

    return Array.from(byResource.entries()).map(([resId, data]) => {
      const res = resources.find((r) => r.bookableresourceid === resId);
      const projectIds = Array.from(data.projects.keys());
      return {
        resourceId: resId,
        resourceName: res?.name ?? resId,
        totalPlannedHours: Math.round(data.hours * 10) / 10,
        projectCount: data.projects.size,
        projects: Array.from(data.projects.entries()).map(([pid, h]) => ({ projectId: pid, hours: Math.round(h * 10) / 10 })),
        projectNames: projectIds.map((pid) => projectNameMap.get(pid) ?? pid),
        isOverallocated: data.hours > STANDARD_CAPACITY_HOURS,
      };
    }).sort((a, b) => b.totalPlannedHours - a.totalPlannedHours);
  }, [assignments, resources]);

  const recommendations: CapacityRecommendation[] = useMemo(() => {
    const recs: CapacityRecommendation[] = [];
    for (const e of entries) {
      if (e.totalPlannedHours > STANDARD_CAPACITY_HOURS * 1.2) {
        recs.push({
          resourceId: e.resourceId,
          resourceName: e.resourceName,
          type: 'overloaded',
          totalHours: e.totalPlannedHours,
          suggestion: `${e.resourceName} is allocated ${Math.round(e.totalPlannedHours)}h across ${e.projectCount} projects (${Math.round((e.totalPlannedHours / STANDARD_CAPACITY_HOURS) * 100)}% capacity). Consider redistributing work.`,
        });
      } else if (e.totalPlannedHours < STANDARD_CAPACITY_HOURS * 0.3 && e.projectCount > 0) {
        recs.push({
          resourceId: e.resourceId,
          resourceName: e.resourceName,
          type: 'underutilized',
          totalHours: e.totalPlannedHours,
          suggestion: `${e.resourceName} has only ${Math.round(e.totalPlannedHours)}h planned (${Math.round((e.totalPlannedHours / STANDARD_CAPACITY_HOURS) * 100)}% capacity). Available for additional assignments.`,
        });
      }
    }
    return recs;
  }, [entries]);

  return {
    entries,
    recommendations,
    isLoading: loadingA || loadingR,
    overallocatedCount: entries.filter((e) => e.isOverallocated).length,
    totalResources: entries.length,
  };
}
