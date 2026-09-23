/**
 * Global search — per-category OData query functions.
 *
 * Each function fires a single dv.list() with a contains() filter and returns a
 * uniform SearchResult[]. Results are capped at SEARCH_TOP per category to keep
 * live-query round-trips light (the UI will show at most SEARCH_DISPLAY_CAP results
 * per category with a "N more — refine your search" hint).
 *
 * All functions are pure async — no React hooks, no side effects. They are called
 * from the GlobalSearchBar component inside a debounced useEffect, not from React
 * Query (search is transient/live, not cached).
 *
 * Visibility gating lives in the caller (GlobalSearchBar) via useSearchVisibility().
 * These functions do NOT apply team/user filters — they mirror the same trust model
 * every existing list page uses (Global Read on the Dataverse role; no client-side
 * team restriction for viewing).
 *
 * Navigation targets use the URL-state contract ProjectDetailPage already reads
 * via useUrlState('tab', ...) so results deep-link to the right tab/subtab.
 */
import * as dv from './dataverseClient';
import { ENTITY_SETS } from './constants';
import { usesCustomTables } from './taskSource';
import type { DataSource } from './taskSource';
import { readProjectValue } from './projectLookupRef';
import { hpiDisplayName } from '../features/teams/payer-initiatives/api/hpi.api';

/** Maximum rows per category fetched from Dataverse. */
export const SEARCH_TOP = 10;
/** Maximum rows displayed per category in the UI (with "N more" hint). */
export const SEARCH_DISPLAY_CAP = 5;
/** Minimum query length before any search fires (matches SearchableSelect convention). */
export const SEARCH_MIN_LENGTH = 2;

// ─── Shared result type ────────────────────────────────────────────────────

export type SearchCategory =
  | 'project'
  | 'program'
  | 'task'
  | 'checklistItem'
  | 'note'
  | 'risk'
  | 'issue'
  | 'change'
  | 'decision'
  | 'statusReport'
  | 'intakeRequest'
  | 'payerIssue'
  | 'hpi'
  | 'feedback'
  | 'notification';

export interface SearchResult {
  id: string;
  category: SearchCategory;
  /** Primary display text (entity name/title). */
  label: string;
  /** Secondary line, e.g. parent project name. */
  sublabel?: string;
  /** Route path to navigate to on click. */
  routePath: string;
  /** Optional ?-prefixed URL search-params string, e.g. '?tab=monitor&subtab=risks' */
  routeSearch?: string;
}

// ─── Helper: escape OData string literal ─────────────────────────────────

function esc(q: string): string {
  return q.replace(/'/g, "''");
}

// ─── Batch resolve project names by id ───────────────────────────────────

/**
 * Given a list of project GUIDs, return a map id→name.
 * Uses pmo_projects (custom) with a chunked OR filter — same pattern as
 * resolveUserNames in permissions.api.ts.
 */
async function resolveProjectNames(
  ids: string[],
  source: DataSource,
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const entitySet = usesCustomTables(source) ? 'pmo_projects' : ENTITY_SETS.project;
  const idField = usesCustomTables(source) ? 'pmo_projectid' : 'msdyn_projectid';
  const nameField = usesCustomTables(source) ? 'pmo_subject' : 'msdyn_subject';
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 50) chunks.push(unique.slice(i, i + 50));
  const out = new Map<string, string>();
  for (const chunk of chunks) {
    const filter = chunk.map((id) => `${idField} eq ${id}`).join(' or ');
    const rows = await dv.list<Record<string, string>>(entitySet, {
      $select: [idField, nameField],
      $filter: filter,
    });
    for (const r of rows) {
      const id = String(r[idField] ?? '').toLowerCase();
      const name = String(r[nameField] ?? '');
      if (id) out.set(id, name);
    }
  }
  return out;
}

// ─── 1. Projects ──────────────────────────────────────────────────────────

export async function searchProjects(q: string, source: DataSource): Promise<SearchResult[]> {
  const s = esc(q);
  if (usesCustomTables(source)) {
    const rows = await dv.list<{
      pmo_projectid: string;
      pmo_subject?: string;
      pmo_description?: string;
      '_pmo_program_value'?: string;
      '_pmo_program_value@OData.Community.Display.V1.FormattedValue'?: string;
    }>('pmo_projects', {
      $select: ['pmo_projectid', 'pmo_subject', 'pmo_description', '_pmo_program_value'],
      $filter: `statecode eq 0 and (contains(pmo_subject,'${s}') or contains(pmo_description,'${s}'))`,
      $top: SEARCH_TOP,
      $orderby: 'pmo_subject asc',
    });
    return rows.map((r) => {
      const programName = r['_pmo_program_value@OData.Community.Display.V1.FormattedValue'];
      return {
        id: r.pmo_projectid,
        category: 'project' as const,
        label: r.pmo_subject ?? '(untitled)',
        sublabel: programName ? `Program: ${programName}` : undefined,
        routePath: `/projects/${r.pmo_projectid}`,
      };
    });
  }
  // PSS source
  const rows = await dv.list<{
    msdyn_projectid: string;
    msdyn_subject?: string;
    '_msdyn_program_value'?: string;
    '_msdyn_program_value@OData.Community.Display.V1.FormattedValue'?: string;
  }>(ENTITY_SETS.project, {
    $select: ['msdyn_projectid', 'msdyn_subject', '_msdyn_program_value'],
    $filter: `statecode eq 0 and contains(msdyn_subject,'${s}')`,
    $top: SEARCH_TOP,
    $orderby: 'msdyn_subject asc',
  });
  return rows.map((r) => {
    const programName = r['_msdyn_program_value@OData.Community.Display.V1.FormattedValue'];
    return {
      id: r.msdyn_projectid,
      category: 'project' as const,
      label: r.msdyn_subject ?? '(untitled)',
      sublabel: programName ? `Program: ${programName}` : undefined,
      routePath: `/projects/${r.msdyn_projectid}`,
    };
  });
}

// ─── 2. Programs ──────────────────────────────────────────────────────────

export async function searchPrograms(q: string): Promise<SearchResult[]> {
  const s = esc(q);
  const rows = await dv.list<{ msdyn_projectprogramid: string; msdyn_name?: string }>(
    ENTITY_SETS.program, {
      $select: ['msdyn_projectprogramid', 'msdyn_name'],
      $filter: `statecode eq 0 and contains(msdyn_name,'${s}')`,
      $top: SEARCH_TOP,
      $orderby: 'msdyn_name asc',
    });
  return rows.map((r) => ({
    id: r.msdyn_projectprogramid,
    category: 'program' as const,
    label: r.msdyn_name ?? '(untitled)',
    routePath: `/programs/${r.msdyn_projectprogramid}`,
  }));
}

// ─── 3. Tasks ─────────────────────────────────────────────────────────────

export async function searchTasks(q: string, source: DataSource): Promise<SearchResult[]> {
  const s = esc(q);
  if (usesCustomTables(source)) {
    const rows = await dv.list<{ pmo_taskid: string; pmo_subject?: string; _pmo_projectref_value?: string }>(
      'pmo_tasks', {
        $select: ['pmo_taskid', 'pmo_subject', '_pmo_projectref_value'],
        $filter: `statecode eq 0 and contains(pmo_subject,'${s}')`,
        $top: SEARCH_TOP,
        $orderby: 'pmo_subject asc',
      });
    const projectIds = rows.map((r) => r._pmo_projectref_value).filter((id): id is string => !!id);
    const nameMap = await resolveProjectNames(projectIds, source);
    return rows.map((r) => {
      const projId = r._pmo_projectref_value ?? '';
      return {
        id: r.pmo_taskid,
        category: 'task' as const,
        label: r.pmo_subject ?? '(untitled)',
        sublabel: nameMap.get(projId.toLowerCase())
          ? `Project: ${nameMap.get(projId.toLowerCase())}`
          : undefined,
        routePath: `/projects/${projId}`,
        routeSearch: `?tab=tasks&view=board&task=${r.pmo_taskid}`,
      };
    });
  }
  const rows = await dv.list<{ msdyn_projecttaskid: string; msdyn_subject?: string; '_msdyn_project_value'?: string }>(
    ENTITY_SETS.projectTask, {
      $select: ['msdyn_projecttaskid', 'msdyn_subject', '_msdyn_project_value'],
      $filter: `statecode eq 0 and contains(msdyn_subject,'${s}')`,
      $top: SEARCH_TOP,
      $orderby: 'msdyn_subject asc',
    });
  const projectIds = rows.map((r) => r['_msdyn_project_value']).filter((id): id is string => !!id);
  const nameMap = await resolveProjectNames(projectIds, source);
  return rows.map((r) => {
    const projId = r['_msdyn_project_value'] ?? '';
    return {
      id: r.msdyn_projecttaskid,
      category: 'task' as const,
      label: r.msdyn_subject ?? '(untitled)',
      sublabel: nameMap.get(projId.toLowerCase())
        ? `Project: ${nameMap.get(projId.toLowerCase())}`
        : undefined,
      routePath: `/projects/${projId}`,
      routeSearch: `?tab=tasks&view=board&task=${r.msdyn_projecttaskid}`,
    };
  });
}

// ─── 4. Checklist items ───────────────────────────────────────────────────

export async function searchChecklistItems(q: string, source: DataSource): Promise<SearchResult[]> {
  const s = esc(q);
  if (usesCustomTables(source)) {
    const rows = await dv.list<{ pmo_checklistid: string; pmo_name?: string; _pmo_task_value?: string }>(
      'pmo_checklists', {
        $select: ['pmo_checklistid', 'pmo_name', '_pmo_task_value'],
        $filter: `statecode eq 0 and contains(pmo_name,'${s}')`,
        $top: SEARCH_TOP,
        $orderby: 'pmo_name asc',
      });
    // Resolve task→project via a task batch query
    const taskIds = rows.map((r) => r._pmo_task_value).filter((id): id is string => !!id);
    const taskToProject = new Map<string, string>();
    const taskToName = new Map<string, string>();
    if (taskIds.length > 0) {
      const unique = [...new Set(taskIds)];
      const chunks: string[][] = [];
      for (let i = 0; i < unique.length; i += 50) chunks.push(unique.slice(i, i + 50));
      for (const chunk of chunks) {
        const filter = chunk.map((id) => `pmo_taskid eq ${id}`).join(' or ');
        const tasks = await dv.list<{ pmo_taskid: string; pmo_subject?: string; _pmo_projectref_value?: string }>(
          'pmo_tasks', { $select: ['pmo_taskid', 'pmo_subject', '_pmo_projectref_value'], $filter: filter });
        for (const t of tasks) {
          const tid = t.pmo_taskid.toLowerCase();
          if (t._pmo_projectref_value) taskToProject.set(tid, t._pmo_projectref_value);
          if (t.pmo_subject) taskToName.set(tid, t.pmo_subject);
        }
      }
    }
    return rows.map((r) => {
      const taskId = (r._pmo_task_value ?? '').toLowerCase();
      const projId = taskToProject.get(taskId) ?? '';
      const taskName = taskToName.get(taskId);
      const rawTaskId = r._pmo_task_value ?? '';
      return {
        id: r.pmo_checklistid,
        category: 'checklistItem' as const,
        label: r.pmo_name ?? '(untitled)',
        sublabel: taskName ? `Task: ${taskName}` : undefined,
        routePath: projId ? `/projects/${projId}` : '/',
        routeSearch: rawTaskId ? `?tab=tasks&view=board&task=${rawTaskId}` : '?tab=tasks&view=board',
      };
    });
  }
  // PSS checklist
  const rows = await dv.list<{ msdyn_projectchecklistid: string; msdyn_name?: string; '_msdyn_projecttaskid_value'?: string }>(
    ENTITY_SETS.projectChecklist, {
      $select: ['msdyn_projectchecklistid', 'msdyn_name', '_msdyn_projecttaskid_value'],
      $filter: `statecode eq 0 and contains(msdyn_name,'${s}')`,
      $top: SEARCH_TOP,
    });
  return rows.map((r) => {
    const taskId = r['_msdyn_projecttaskid_value'] ?? '';
    return {
      id: r.msdyn_projectchecklistid,
      category: 'checklistItem' as const,
      label: r.msdyn_name ?? '(untitled)',
      routePath: '/',
      routeSearch: taskId ? `?tab=tasks&view=board&task=${taskId}` : '?tab=tasks&view=board',
    };
  });
}

// ─── 5. Notes ─────────────────────────────────────────────────────────────

export async function searchNotes(q: string): Promise<SearchResult[]> {
  const s = esc(q);
  const rows = await dv.list<{
    annotationid: string;
    subject?: string;
    notetext?: string;
    '_objectid_value'?: string;
    objecttypecode?: string;
  }>(ENTITY_SETS.annotation, {
    $select: ['annotationid', 'subject', 'notetext', '_objectid_value', 'objecttypecode'],
    $filter: `isdocument eq false and (contains(subject,'${s}') or contains(notetext,'${s}'))`,
    $top: SEARCH_TOP,
    $orderby: 'createdon desc',
  });

  // Batch-resolve task→project for task-scoped notes (same pattern as searchChecklistItems).
  const taskRows = rows.filter((r) =>
    (r.objecttypecode === 'msdyn_projecttask' || r.objecttypecode === 'pmo_task') &&
    !!r['_objectid_value'],
  );
  const taskToProject = new Map<string, string>();
  if (taskRows.length > 0) {
    const taskIds = [...new Set(taskRows.map((r) => r['_objectid_value']!))];
    const chunks: string[][] = [];
    for (let i = 0; i < taskIds.length; i += 50) chunks.push(taskIds.slice(i, i + 50));
    for (const chunk of chunks) {
      // Try custom table first, fall back silently
      try {
        const filter = chunk.map((id) => `pmo_taskid eq ${id}`).join(' or ');
        const tasks = await dv.list<{ pmo_taskid: string; _pmo_projectref_value?: string }>(
          'pmo_tasks', { $select: ['pmo_taskid', '_pmo_projectref_value'], $filter: filter });
        for (const t of tasks) {
          if (t._pmo_projectref_value) taskToProject.set(t.pmo_taskid.toLowerCase(), t._pmo_projectref_value);
        }
      } catch {
        try {
          const filter = chunk.map((id) => `msdyn_projecttaskid eq ${id}`).join(' or ');
          const tasks = await dv.list<{ msdyn_projecttaskid: string; '_msdyn_project_value'?: string }>(
            'msdyn_projecttasks', { $select: ['msdyn_projecttaskid', '_msdyn_project_value'], $filter: filter });
          for (const t of tasks) {
            if (t['_msdyn_project_value']) taskToProject.set(t.msdyn_projecttaskid.toLowerCase(), t['_msdyn_project_value']);
          }
        } catch { /* best effort */ }
      }
    }
  }

  return rows
    .map((r) => {
      const parentId = r['_objectid_value'] ?? '';
      const isProject = r.objecttypecode === 'msdyn_project' || r.objecttypecode === 'pmo_project';
      const isTask = r.objecttypecode === 'msdyn_projecttask' || r.objecttypecode === 'pmo_task';
      let routePath = '';
      let routeSearch: string | undefined;
      if (isProject && parentId) {
        routePath = `/projects/${parentId}`;
        routeSearch = '?tab=notes';
      } else if (isTask && parentId) {
        const projId = taskToProject.get(parentId.toLowerCase());
        if (projId) {
          routePath = `/projects/${projId}`;
          routeSearch = `?tab=tasks&view=board&task=${parentId}`;
        }
      }
      if (!routePath) return null; // skip notes with no resolvable route
      return {
        id: r.annotationid,
        category: 'note' as const,
        label: r.subject || (r.notetext?.slice(0, 60) + '…') || '(note)',
        routePath,
        routeSearch,
      };
    })
    .filter((r) => r !== null) as SearchResult[];
}

// ─── 6. Risks ─────────────────────────────────────────────────────────────

export async function searchRisks(q: string, source: DataSource): Promise<SearchResult[]> {
  const s = esc(q);
  const entitySet = usesCustomTables(source) ? 'pmo_projectrisks' : ENTITY_SETS.projectRisk;
  const idField = usesCustomTables(source) ? 'pmo_projectriskid' : 'msdyn_projectriskid';
  const nameField = usesCustomTables(source) ? 'pmo_subject' : 'msdyn_name';
  const projField = usesCustomTables(source) ? '_pmo_project_value' : '_msdyn_project_value';
  const rows = await dv.list<Record<string, string>>(entitySet, {
    $select: [idField, nameField, projField],
    $filter: `statecode eq 0 and (contains(${nameField},'${s}'))`,
    $top: SEARCH_TOP,
  });
  const projectIds = rows.map((r) => r[projField]).filter((id): id is string => !!id);
  const nameMap = await resolveProjectNames(projectIds, source);
  return rows.map((r) => {
    const projId = r[projField] ?? '';
    return {
      id: r[idField],
      category: 'risk' as const,
      label: r[nameField] ?? '(untitled)',
      sublabel: nameMap.get(projId.toLowerCase()),
      routePath: `/projects/${projId}`,
      routeSearch: '?tab=monitor&subtab=risks',
    };
  });
}

// ─── 7. Issues ────────────────────────────────────────────────────────────

export async function searchIssues(q: string, source: DataSource): Promise<SearchResult[]> {
  const s = esc(q);
  const entitySet = usesCustomTables(source) ? 'pmo_projectissues' : ENTITY_SETS.projectIssue;
  const idField = usesCustomTables(source) ? 'pmo_projectissueid' : 'msdyn_projectissueid';
  const nameField = usesCustomTables(source) ? 'pmo_subject' : 'msdyn_name';
  const projField = usesCustomTables(source) ? '_pmo_project_value' : '_msdyn_project_value';
  const rows = await dv.list<Record<string, string>>(entitySet, {
    $select: [idField, nameField, projField],
    $filter: `statecode eq 0 and contains(${nameField},'${s}')`,
    $top: SEARCH_TOP,
  });
  const projectIds = rows.map((r) => r[projField]).filter((id): id is string => !!id);
  const nameMap = await resolveProjectNames(projectIds, source);
  return rows.map((r) => {
    const projId = r[projField] ?? '';
    return {
      id: r[idField],
      category: 'issue' as const,
      label: r[nameField] ?? '(untitled)',
      sublabel: nameMap.get(projId.toLowerCase()),
      routePath: `/projects/${projId}`,
      routeSearch: '?tab=monitor&subtab=issues',
    };
  });
}

// ─── 8. Changes ───────────────────────────────────────────────────────────

export async function searchChanges(q: string, source: DataSource): Promise<SearchResult[]> {
  const s = esc(q);
  const entitySet = usesCustomTables(source) ? 'pmo_projectchanges' : ENTITY_SETS.projectChange;
  const idField = usesCustomTables(source) ? 'pmo_projectchangeid' : 'msdyn_projectchangeid';
  const nameField = usesCustomTables(source) ? 'pmo_subject' : 'msdyn_name';
  const projField = usesCustomTables(source) ? '_pmo_project_value' : '_msdyn_project_value';
  const rows = await dv.list<Record<string, string>>(entitySet, {
    $select: [idField, nameField, projField],
    $filter: `statecode eq 0 and contains(${nameField},'${s}')`,
    $top: SEARCH_TOP,
  });
  const projectIds = rows.map((r) => r[projField]).filter((id): id is string => !!id);
  const nameMap = await resolveProjectNames(projectIds, source);
  return rows.map((r) => {
    const projId = r[projField] ?? '';
    return {
      id: r[idField],
      category: 'change' as const,
      label: r[nameField] ?? '(untitled)',
      sublabel: nameMap.get(projId.toLowerCase()),
      routePath: `/projects/${projId}`,
      routeSearch: '?tab=monitor&subtab=changes',
    };
  });
}

// ─── 9. Decisions ─────────────────────────────────────────────────────────

export async function searchDecisions(q: string): Promise<SearchResult[]> {
  const s = esc(q);
  const rows = await dv.list<{
    pmo_projectdecisionid: string;
    pmo_name?: string;
    pmo_description?: string;
    '_pmo_projectref_value'?: string;
    '_pmo_project_value'?: string;
  }>('pmo_projectdecisions', {
    $select: ['pmo_projectdecisionid', 'pmo_name', 'pmo_description', '_pmo_projectref_value', '_pmo_project_value'],
    $filter: `statecode eq 0 and (contains(pmo_name,'${s}') or contains(pmo_description,'${s}'))`,
    $top: SEARCH_TOP,
  });
  return rows.map((r) => {
    const projId = readProjectValue(r as Record<string, unknown>) ?? '';
    return {
      id: r.pmo_projectdecisionid,
      category: 'decision' as const,
      label: r.pmo_name ?? '(untitled)',
      routePath: `/projects/${projId}`,
      routeSearch: '?tab=govern',
    };
  });
}

// ─── 10. Status Reports ───────────────────────────────────────────────────

export async function searchStatusReports(q: string, source: DataSource): Promise<SearchResult[]> {
  const s = esc(q);
  const entitySet = usesCustomTables(source) ? 'pmo_projectstatusreports' : ENTITY_SETS.statusReport;
  const idField = usesCustomTables(source) ? 'pmo_projectstatusreportid' : 'msdyn_projectstatusreportid';
  const projField = usesCustomTables(source) ? '_pmo_project_value' : '_msdyn_project_value';
  const rows = await dv.list<Record<string, string>>(entitySet, {
    $select: [idField, projField, 'msdyn_accomplishedactivities', 'msdyn_plannedactivities', 'msdyn_additionalcomments'],
    $filter: `statecode eq 0 and (contains(msdyn_accomplishedactivities,'${s}') or contains(msdyn_plannedactivities,'${s}') or contains(msdyn_additionalcomments,'${s}'))`,
    $top: SEARCH_TOP,
  });
  const projectIds = rows.map((r) => r[projField]).filter((id): id is string => !!id);
  const nameMap = await resolveProjectNames(projectIds, source);
  return rows.map((r) => {
    const projId = r[projField] ?? '';
    const projName = nameMap.get(projId.toLowerCase());
    return {
      id: r[idField],
      category: 'statusReport' as const,
      label: projName ? `Status Report — ${projName}` : 'Status Report',
      sublabel: projName,
      routePath: `/projects/${projId}`,
      routeSearch: '?tab=status',
    };
  });
}

// ─── 11. Intake Requests ──────────────────────────────────────────────────

export async function searchProjectRequests(q: string): Promise<SearchResult[]> {
  const s = esc(q);
  const rows = await dv.list<{ pmo_projectrequestid: string; pmo_name?: string; pmo_description?: string }>(
    'pmo_projectrequests', {
      $select: ['pmo_projectrequestid', 'pmo_name', 'pmo_description'],
      $filter: `statecode eq 0 and (contains(pmo_name,'${s}') or contains(pmo_description,'${s}'))`,
      $top: SEARCH_TOP,
      $orderby: 'pmo_name asc',
    });
  return rows.map((r) => ({
    id: r.pmo_projectrequestid,
    category: 'intakeRequest' as const,
    label: r.pmo_name ?? '(untitled)',
    routePath: `/intake/${r.pmo_projectrequestid}`,
  }));
}

// ─── 12. Payer Inquiries (Payer Initiatives gate) ─────────────────────────

export async function searchPayerIssues(q: string): Promise<SearchResult[]> {
  const s = esc(q);
  const rows = await dv.list<{ cr87a_payerissueid: string; cr87a_name?: string; cr87a_shortdescription?: string; cr87a_payerissueidauto?: string }>(
    ENTITY_SETS.payerIssue, {
      $select: ['cr87a_payerissueid', 'cr87a_name', 'cr87a_payerissueidauto', 'cr87a_shortdescription'],
      $filter: `statecode eq 0 and (contains(cr87a_name,'${s}') or contains(cr87a_shortdescription,'${s}'))`,
      $top: SEARCH_TOP,
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('0x80040217') || /Resource not found/.test(msg)) return [];
      throw err;
    });
  return rows.map((r) => ({
    id: r.cr87a_payerissueid,
    category: 'payerIssue' as const,
    label: r.cr87a_payerissueidauto
      ? `${r.cr87a_payerissueidauto} — ${r.cr87a_name ?? ''}`
      : (r.cr87a_name ?? '(untitled)'),
    sublabel: r.cr87a_shortdescription?.slice(0, 80),
    routePath: '/payer-issues',
    routeSearch: `?id=${r.cr87a_payerissueid}`,
  }));
}

// ─── 13. HPI (Payer Initiatives gate) ────────────────────────────────────

export async function searchHpiIssues(q: string): Promise<SearchResult[]> {
  const s = esc(q);
  const rows = await dv.list<{ rcm_payerdeckissueid: string; rcm_issuenumber?: string; rcm_statusdetails?: string; rcm_name?: string }>(
    ENTITY_SETS.hpiIssue, {
      $select: ['rcm_payerdeckissueid', 'rcm_issuenumber', 'rcm_statusdetails', 'rcm_name'],
      $filter: `statecode eq 0 and contains(rcm_statusdetails,'${s}')`,
      $top: SEARCH_TOP,
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('0x80040217') || /Resource not found/.test(msg)) return [];
      throw err;
    });
  return rows.map((r) => ({
    id: r.rcm_payerdeckissueid,
    category: 'hpi' as const,
    label: hpiDisplayName(r as Parameters<typeof hpiDisplayName>[0]),
    routePath: '/hpi',
    routeSearch: `?id=${r.rcm_payerdeckissueid}`,
  }));
}

// ─── 14. User Feedback (admin-only) ──────────────────────────────────────

export async function searchUserFeedback(q: string): Promise<SearchResult[]> {
  const s = esc(q);
  const rows = await dv.list<{ pmo_userfeedbackid: string; pmo_title?: string; pmo_description?: string }>(
    'pmo_userfeedbacks', {
      $select: ['pmo_userfeedbackid', 'pmo_title', 'pmo_description'],
      $filter: `statecode eq 0 and (contains(pmo_title,'${s}') or contains(pmo_description,'${s}'))`,
      $top: SEARCH_TOP,
      $orderby: 'pmo_title asc',
    });
  return rows.map((r) => ({
    id: r.pmo_userfeedbackid,
    category: 'feedback' as const,
    label: r.pmo_title ?? '(untitled)',
    routePath: `/admin/user-feedback/${r.pmo_userfeedbackid}`,
  }));
}

// ─── 15. Notifications (client-side filter, no extra Dataverse query) ──────

import type { Notification } from '../models/notification.model';

export function searchNotifications(q: string, notifications: Notification[]): SearchResult[] {
  if (!q.trim()) return [];
  const lower = q.toLowerCase();
  return notifications
    .filter((n) =>
      n.pmo_title?.toLowerCase().includes(lower) ||
      n.pmo_body?.toLowerCase().includes(lower)
    )
    .slice(0, SEARCH_TOP)
    .map((n) => ({
      id: n.pmo_notificationid,
      category: 'notification' as const,
      label: n.pmo_title,
      sublabel: n.pmo_body?.slice(0, 80),
      routePath: n.pmo_actionurl ?? '/',
    }));
}
