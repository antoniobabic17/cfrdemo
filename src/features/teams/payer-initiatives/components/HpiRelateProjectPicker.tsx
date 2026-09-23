/**
 * Picker for relating an existing msdyn_project to an HPI. Three modes of
 * project sourcing plus two component shapes:
 *
 *   Component:
 *     HpiRelateProjectPicker  — controlled component that returns the
 *                               selected project id via onChange.
 *     HpiProjectAttacher      — mini-form wrapper that additionally writes
 *                               the pmo_PayerInitiatives_HpiIssue lookup
 *                               on the chosen project.
 *
 *   Project source (both components accept these props):
 *     preload='payer-initiatives' (default)
 *         Uses useActivePayerInitiativeProjects() to pre-populate the
 *         entire team's active project list up front — the operator can
 *         click the trigger and see every option immediately, no typing
 *         required. This is what the HPI create/edit drawer wants
 *         per the 2026-07-13 operator ask.
 *
 *     preload='none'
 *         Falls back to server-side contains() search on msdyn_subject.
 *         Kept for callers who need to attach a project outside the
 *         Payer Initiatives team.
 */
import { useCallback, useMemo } from 'react';
import { SearchableSelect, type SelectOption } from '../../../../components/common/SearchableSelect';
import * as dv from '../../../../lib/dataverseClient';
import { ENTITY_SETS } from '../../../../lib/constants';
import { useRelateProjectToHpi, useActivePayerInitiativeProjects } from '../hooks/useHpiIssues';
import { useDataSource, usesCustomTables } from '../../../../lib/taskSource';
import { toast } from '../../../../hooks/useToast';

interface ProjectRow {
  msdyn_projectid: string;
  msdyn_subject?: string;
  pmo_legacyprojectid?: string;
}

function fmtProject(p: ProjectRow): string {
  const legacy = p.pmo_legacyprojectid ? `${p.pmo_legacyprojectid} — ` : '';
  return `${legacy}${p.msdyn_subject ?? '(untitled)'}`;
}

function escapeOdata(v: string): string { return v.replace(/'/g, "''"); }

type PickerSource = 'payer-initiatives' | 'none';

interface PickerProps {
  value: string;
  onChange: (projectId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Default 'payer-initiatives' — pre-populates the dropdown with all
   *  active Payer Initiatives projects so operators do not have to type. */
  source?: PickerSource;
  /** Project ids to hide from the dropdown (e.g. already-related). */
  excludeProjectIds?: string[];
}

/**
 * Controlled project picker — emits a project id only. The caller decides
 * what to write where. No mutation happens here.
 */
export function HpiRelateProjectPicker({
  value, onChange, placeholder, disabled,
  source = 'payer-initiatives',
  excludeProjectIds = [],
}: PickerProps) {
  const preload = source === 'payer-initiatives';
  const dataSource = useDataSource();
  // On the custom source, project search/label reads must hit pmo_projects
  // (the msdyn_project shell has only msdyn_subject and no team scoping).
  const projSet = usesCustomTables(dataSource) ? 'pmo_projects' : ENTITY_SETS.project;
  const projId = usesCustomTables(dataSource) ? 'pmo_projectid' : 'msdyn_projectid';
  const projName = usesCustomTables(dataSource) ? 'pmo_subject' : 'msdyn_subject';
  const { data: preloaded, isLoading: preloadLoading } = useActivePayerInitiativeProjects();

  const staticOptions = useMemo<SelectOption[] | undefined>(() => {
    if (!preload) return undefined;
    const excl = new Set(excludeProjectIds);
    return (preloaded ?? [])
      .filter((p) => !excl.has(p.msdyn_projectid))
      .map((p) => ({ value: p.msdyn_projectid, label: fmtProject(p) }));
  }, [preload, preloaded, excludeProjectIds]);

  const searchProjects = useCallback(async (query: string): Promise<SelectOption[]> => {
    const safe = escapeOdata(query);
    const rows = await dv.list<Record<string, unknown>>(projSet, {
      $select: [projId, projName],
      $filter: `statecode eq 0 and contains(${projName},'${safe}')`,
      $orderby: `${projName} asc`,
      $top: 25,
    });
    const excl = new Set(excludeProjectIds);
    return rows
      .map((r) => ({ msdyn_projectid: r[projId] as string, msdyn_subject: r[projName] as string | undefined }))
      .filter((p) => !excl.has(p.msdyn_projectid))
      .map((p) => ({ value: p.msdyn_projectid, label: fmtProject(p) }));
  }, [excludeProjectIds, projSet, projId, projName]);

  const resolveLabel = useCallback(async (id: string): Promise<string> => {
    if (!id) return '';
    // In preload mode the label is already known from the cached list.
    if (preload && preloaded) {
      const hit = preloaded.find((p) => p.msdyn_projectid === id);
      if (hit) return fmtProject(hit);
    }
    const r = await dv.get<Record<string, unknown>>(projSet, id, [projId, projName]);
    return fmtProject({ msdyn_projectid: r[projId] as string, msdyn_subject: r[projName] as string | undefined });
  }, [preload, preloaded, projSet, projId, projName]);

  const derivedPlaceholder = placeholder ?? (preload
    ? (preloadLoading ? 'Loading projects…' : 'Select a project…')
    : 'Search projects…');

  if (preload) {
    // Static-options path: the SearchableSelect renders the full list
    // client-side and filters as the user types (still supports typeahead
    // for large teams, but no typing is *required*).
    return (
      <SearchableSelect
        value={value}
        onChange={onChange}
        options={staticOptions ?? []}
        resolveLabel={resolveLabel}
        placeholder={derivedPlaceholder}
        disabled={disabled || preloadLoading}
      />
    );
  }

  return (
    <SearchableSelect
      value={value}
      onChange={onChange}
      onSearch={searchProjects}
      resolveLabel={resolveLabel}
      placeholder={derivedPlaceholder}
      disabled={disabled}
    />
  );
}

interface AttacherProps {
  hpiId: string;
  onAttached: () => void;
  /** Project ids already linked — excluded from the picker. */
  excludeProjectIds?: string[];
  /** Same source semantics as the picker. Default 'payer-initiatives'. */
  source?: PickerSource;
}

/**
 * Mini-form: pick a project + Attach button. Writes pmo_PayerInitiatives_HpiIssue@odata.bind
 * on the chosen project. Used from HpiDetailDrawer's Related Projects tab.
 */
export function HpiProjectAttacher({
  hpiId, onAttached, excludeProjectIds = [], source = 'payer-initiatives',
}: AttacherProps) {
  const relate = useRelateProjectToHpi();

  async function handleAttach(projectId: string) {
    if (!projectId) return;
    if (excludeProjectIds.includes(projectId)) {
      toast.error('That project is already related to this HPI.');
      return;
    }
    try {
      await relate.mutateAsync({ projectId, hpiId });
      toast.success('Project related to HPI.');
      onAttached();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Couldn’t relate project: ${msg}`);
    }
  }

  return (
    <HpiRelateProjectPicker
      value=""
      onChange={handleAttach}
      placeholder="Pick a project to relate…"
      disabled={relate.isPending}
      source={source}
      excludeProjectIds={excludeProjectIds}
    />
  );
}
