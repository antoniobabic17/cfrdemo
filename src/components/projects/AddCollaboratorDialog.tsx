/**
 * AddCollaboratorDialog — Individual collaboration mode add flow.
 *
 * A single search box returns both PMO teams and people (via usePeopleSearch).
 * - Selecting a PERSON → single checkbox row → confirm → one pmo_projectcollaborator row.
 * - Selecting a TEAM → expands inline to the team's member list (admins excluded)
 *   with Select all + per-member checkboxes → confirm → one row per checked member,
 *   viaTeam = that team's id.
 */
import { useState, useCallback, useRef } from 'react';
import { Search, Users, User, ChevronDown, ChevronRight, Loader2, Check } from 'lucide-react';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../ui/dialog';
import { usePeopleSearch, resolveSystemUserForAadId, type Person } from '../../lib/peopleSearch';
import { toast } from '../../hooks/useToast';
import { useAllPmoTeams } from '../../hooks/useAllPmoTeams';
import { useTeamMembersFiltered, type TeamMemberFiltered } from '../../hooks/useTeamMembersFiltered';
import type { AccessMapEntry } from '../../hooks/useProjectAccessMap';
import { displayTeamName } from '../../lib/pmoTeams';
import { cn } from '../../lib/utils';

interface AddCollaboratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Called with the entries to add. Caller handles the mutation + loading state. */
  onAdd: (entries: Array<{ userId: string; viaTeamId: string | null }>) => void;
  pending: boolean;
  /** Map of systemuserid (lowercase) -> { label } for users who already have access. */
  existingAccessMap?: Map<string, AccessMapEntry>;
}

type SelectionKind = 'person' | 'team';

interface Selection {
  kind: SelectionKind;
  id: string;       // systemuserid (or best-available id) for person, teamid for team
  label: string;
  /** For person selections from o365 source: the AAD object id to resolve to systemuserid if id is not already a systemuserid. */
  aadId?: string;
  /** True when id is confirmed to be a Dataverse systemuserid (not an AAD object id). */
  isSystemUserId?: boolean;
}

// ── Team expander ──────────────────────────────────────────────────────────────

function TeamMemberPicker({
  teamId,
  teamLabel,
  checkedIds,
  onToggle,
  onSelectAll,
  existingAccessMap,
}: {
  teamId: string;
  teamLabel: string;
  checkedIds: Set<string>;
  onToggle: (userId: string) => void;
  onSelectAll: (members: TeamMemberFiltered[]) => void;
  existingAccessMap?: Map<string, { label: string }>;
}) {
  const { data: members = [], isLoading } = useTeamMembersFiltered(teamId);
  // "Select all" only covers non-admin members — admins can be added individually
  // via the people search but shouldn't be bulk-selected in the team picker.
  const nonAdminMembers = members.filter((m) => !m.isAdmin);
  // Exclude members who already have access from Select All
  const selectableMembers = nonAdminMembers.filter((m) => !existingAccessMap?.has(m.systemuserid.toLowerCase()));
  const allChecked = selectableMembers.length > 0 && selectableMembers.every((m) => checkedIds.has(m.systemuserid));

  return (
    <div className="mt-2 rounded-md border border-border bg-muted/20 p-3 space-y-2">
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading {teamLabel} members…
        </div>
      ) : members.length === 0 ? (
        <p className="text-xs text-muted-foreground">No eligible members found.</p>
      ) : (
        <>
          {/* Select all */}
          <label className="flex items-center gap-2 cursor-pointer pb-1 border-b border-border">
            <Checkbox
              checked={allChecked}
              onCheckedChange={() => onSelectAll(members)}
            />
            <span className="text-xs font-medium text-foreground">Select all ({selectableMembers.length})</span>
          </label>
          {/* Per-member rows */}
          {members.map((m) => {
            const existingAccess = existingAccessMap?.get(m.systemuserid.toLowerCase());
            return (
            <label key={m.systemuserid} className={`flex items-center gap-2 ${existingAccess ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
              <Checkbox
                checked={checkedIds.has(m.systemuserid)}
                onCheckedChange={() => { if (!existingAccess) onToggle(m.systemuserid); }}
                disabled={!!existingAccess}
              />
              <span className="text-xs text-foreground">{m.fullname}</span>
              {m.isAdmin && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 shrink-0">Admin</span>
              )}
              {existingAccess && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 shrink-0" title={`Has access via ${existingAccess.label}`}>Has access</span>
              )}
              {m.internalemailaddress && (
                <span className="text-xs text-muted-foreground truncate">({m.internalemailaddress})</span>
              )}
            </label>
          );
          })}
        </>
      )}
    </div>
  );
}

// ── Main dialog ────────────────────────────────────────────────────────────────

export function AddCollaboratorDialog({
  open, onOpenChange, onAdd, pending,
  existingAccessMap,
}: AddCollaboratorDialogProps) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [personResults, setPersonResults] = useState<Person[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Selected item (either a single person, or a team to expand)
  const [selection, setSelection] = useState<Selection | null>(null);
  // For person selection — single checkbox
  const [personChecked, setPersonChecked] = useState(false);
  // For team selection — checked member ids
  const [teamCheckedIds, setTeamCheckedIds] = useState<Set<string>>(new Set());

  const [resolving, setResolving] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<{ name: string; via: string } | null>(null);
  const { searchPeople } = usePeopleSearch();
  const allTeams = useAllPmoTeams({ enabled: open }) ?? [];

  // Filter teams client-side by query
  const teamResults = query.trim().length >= 1
    ? allTeams.filter((t) =>
        displayTeamName(t.name).toLowerCase().includes(query.toLowerCase()) ||
        t.name.toLowerCase().includes(query.toLowerCase()),
      ).slice(0, 10)
    : [];

  // Debounced person search
  const handleQueryChange = useCallback((q: string) => {
    setQuery(q);
    setSelection(null);
    setPersonChecked(false);
    setTeamCheckedIds(new Set());
    clearTimeout(debounceRef.current);
    if (q.trim().length < 2) { setPersonResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchPeople(q);
        setPersonResults(results.slice(0, 15));
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [searchPeople]);

  function selectPerson(p: Person) {
    // Prefer the confirmed Dataverse systemuserid. If only an AAD id is
    // available (o365 search mode), store it as aadId for resolution at
    // confirm time — never bind a AAD object id directly to systemusers.
    setSelection({
      kind: 'person',
      id: p.systemUserId ?? p.id,
      label: p.displayName,
      aadId: p.systemUserId ? undefined : p.aadId,
      isSystemUserId: !!p.systemUserId,
    });
    setPersonChecked(false);
    setTeamCheckedIds(new Set());
  }

  function selectTeam(t: { teamid: string; name: string }) {
    // Toggle: clicking the same team again collapses it.
    if (selection?.kind === 'team' && selection.id === t.teamid) {
      setSelection(null);
      setTeamCheckedIds(new Set());
      return;
    }
    setSelection({ kind: 'team', id: t.teamid, label: displayTeamName(t.name) });
    setPersonChecked(false);
    setTeamCheckedIds(new Set());
  }

  function toggleTeamMember(userId: string) {
    setTeamCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  }

  function selectAllTeamMembers(members: TeamMemberFiltered[]) {
    const nonAdmins = members.filter((m) => !m.isAdmin);
    const allChecked = nonAdmins.length > 0 && nonAdmins.every((m) => teamCheckedIds.has(m.systemuserid));
    if (allChecked) {
      setTeamCheckedIds(new Set());
    } else {
      setTeamCheckedIds(new Set(nonAdmins.map((m) => m.systemuserid)));
    }
  }

  async function handleConfirm() {
    if (!selection) return;
    if (selection.kind === 'person') {
      if (!personChecked) return;
      let systemUserId = selection.id;
      // If we only have an AAD object id (o365 search result with no
      // cached systemuserid), resolve it to a Dataverse systemuserid first.
      // Using an AAD id as a systemuserid will produce a 404 from Dataverse.
      if (!selection.isSystemUserId && selection.aadId) {
        setResolving(true);
        try {
          const resolved = await resolveSystemUserForAadId(selection.aadId);
          if (!resolved?.systemUserId) {
            // This AAD user has no Dataverse account — cannot grant access.
            toast.error("This user doesn't have a Dataverse account in this environment. Ask your admin to provision them first.");
            return;
          }
          systemUserId = resolved.systemUserId;
        } finally {
          setResolving(false);
        }
      }
      // Warn if this user already has access.
            if (existingAccessMap) {
              const existing = existingAccessMap.get(systemUserId.toLowerCase());
              if (existing) {
                setDuplicateWarning({ name: selection.label, via: existing.label });
                return;
              }
            }
            onAdd([{ userId: systemUserId, viaTeamId: null }]);
    } else {
      if (teamCheckedIds.size === 0) return;
      onAdd(Array.from(teamCheckedIds).map((userId) => ({ userId, viaTeamId: selection.id })));
    }
  }

  function handleClose(o: boolean) {
    if (!o) {
      setQuery('');
      setPersonResults([]);
      setSelection(null);
      setPersonChecked(false);
      setTeamCheckedIds(new Set());
    }
    onOpenChange(o);
  }

  const canConfirm = selection
    ? selection.kind === 'person'
      ? personChecked
      : teamCheckedIds.size > 0
    : false;

  // Hide the results dropdown when a team is selected — the member picker replaces it.
  const showResults = query.trim().length >= 1 && selection?.kind !== 'team';
  const hasResults = teamResults.length > 0 || personResults.length > 0 || searching;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Collaborator</DialogTitle>
          <DialogDescription>
            Search for a person or a team. Selecting a team shows its members so you
            can choose who to add individually.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search people or teams…"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Results */}
          {showResults && hasResults && (
            <div className="rounded-md border border-border divide-y divide-border max-h-64 overflow-y-auto">
              {/* Teams */}
              {teamResults.length > 0 && (
                <div>
                  <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/30">Teams</p>
                  {teamResults.map((t) => {
                    const isSelected = selection?.kind === 'team' && selection.id === t.teamid;
                    return (
                      <button
                        key={t.teamid}
                        type="button"
                        onClick={() => selectTeam(t)}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted/40 transition-colors',
                          isSelected && 'bg-primary/5',
                        )}
                      >
                        <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate">{displayTeamName(t.name)}</span>
                        {isSelected
                          ? <ChevronDown className="h-3.5 w-3.5 ml-auto shrink-0 text-primary" />
                          : <ChevronRight className="h-3.5 w-3.5 ml-auto shrink-0 text-muted-foreground" />
                        }
                      </button>
                    );
                  })}
                </div>
              )}

              {/* People */}
              {personResults.length > 0 && (
                <div>
                  <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/30">People</p>
                  {personResults.map((p) => {
                    const uid = p.systemUserId ?? p.id;
                    const isSelected = selection?.kind === 'person' && selection.id === uid;
                    return (
                      <button
                        key={uid}
                        type="button"
                        onClick={() => selectPerson(p)}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted/40 transition-colors',
                          isSelected && 'bg-primary/5',
                        )}
                      >
                        <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <span className="block truncate">{p.displayName}</span>
                          {p.email && <span className="block text-xs text-muted-foreground truncate">{p.email}</span>}
                        </div>
                        {isSelected && <Check className="h-3.5 w-3.5 ml-auto shrink-0 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Selection details */}
          {selection?.kind === 'person' && (
            <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 cursor-pointer hover:bg-muted/20">
              <Checkbox checked={personChecked} onCheckedChange={(v) => setPersonChecked(!!v)} />
              <div>
                <p className="text-sm font-medium text-foreground">{selection.label}</p>
                <p className="text-xs text-muted-foreground">Full access · Individually added</p>
              </div>
            </label>
          )}

          {selection?.kind === 'team' && (
            <TeamMemberPicker
              teamId={selection.id}
              teamLabel={selection.label}
              checkedIds={teamCheckedIds}
              onToggle={toggleTeamMember}
              onSelectAll={selectAllTeamMembers}
              existingAccessMap={existingAccessMap}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" disabled={pending} onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button disabled={!canConfirm || pending || resolving} onClick={() => { void handleConfirm(); }}>
            {(pending || resolving) ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />{resolving ? 'Resolving user…' : 'Adding…'}</> : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Duplicate-access warning */}
      {duplicateWarning && (
        <Dialog open onOpenChange={() => setDuplicateWarning(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Already has access</DialogTitle>
              <DialogDescription>
                <strong>{duplicateWarning.name}</strong> already has edit access to this
                project via <strong>{duplicateWarning.via}</strong>. Adding them again
                would create a redundant grant.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setDuplicateWarning(null)}>OK, got it</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}
