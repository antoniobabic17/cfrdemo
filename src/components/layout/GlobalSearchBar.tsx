/**
 * GlobalSearchBar — all-encompassing search across the app, gated by the
 * viewer's visibility (useSearchVisibility).
 *
 * Mounted in AppShell's header between the greeting block and the
 * ThemeToggle/Shortcuts/Ask Mira cluster.
 *
 * UX shape borrows from SearchableSelect (Popover + debounced input + capped
 * result list) but is a fresh component: this needs grouped, multi-category,
 * always-open-while-typing results with per-category icons, not a
 * single-value pick-and-close.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';
import {
  Search, Loader2, FolderKanban, Network, ListChecks, CheckSquare,
  StickyNote, ShieldAlert, AlertTriangle, GitBranch, Gavel, FileBarChart2,
  Inbox, Tag, Bell,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useSearchVisibility } from '../../hooks/useSearchVisibility';
import { useDataSource } from '../../lib/taskSource';
import { useNotifications } from '../../hooks/useNotifications';
import {
  searchProjects, searchPrograms, searchTasks, searchChecklistItems, searchNotes,
  searchRisks, searchIssues, searchChanges, searchDecisions, searchStatusReports,
  searchProjectRequests, searchPayerIssues, searchHpiIssues, searchUserFeedback,
  searchNotifications,
  SEARCH_MIN_LENGTH, SEARCH_DISPLAY_CAP,
  type SearchResult, type SearchCategory,
} from '../../lib/globalSearch';

const DEBOUNCE_MS = 300;

const CATEGORY_META: Record<SearchCategory, { label: string; icon: typeof FolderKanban }> = {
  project: { label: 'Projects', icon: FolderKanban },
  program: { label: 'Programs', icon: Network },
  task: { label: 'Tasks', icon: CheckSquare },
  checklistItem: { label: 'Checklist Items', icon: ListChecks },
  note: { label: 'Notes', icon: StickyNote },
  risk: { label: 'Risks', icon: ShieldAlert },
  issue: { label: 'Issues', icon: AlertTriangle },
  change: { label: 'Changes', icon: GitBranch },
  decision: { label: 'Decisions', icon: Gavel },
  statusReport: { label: 'Status Reports', icon: FileBarChart2 },
  intakeRequest: { label: 'Intake Requests', icon: Inbox },
  payerIssue: { label: 'Payer Inquiries', icon: AlertTriangle },
  hpi: { label: 'HPI', icon: Tag },
  feedback: { label: 'User Feedback', icon: StickyNote },
  notification: { label: 'Notifications', icon: Bell },
};

// Category display order.
const CATEGORY_ORDER: SearchCategory[] = [
  'project', 'program', 'task', 'checklistItem', 'note',
  'risk', 'issue', 'change', 'decision', 'statusReport',
  'intakeRequest', 'payerIssue', 'hpi', 'feedback', 'notification',
];

export function GlobalSearchBar() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchIdRef = useRef(0);

  const visibility = useSearchVisibility();
  const dataSource = useDataSource();
  const { data: notifications = [] } = useNotifications();

  useEffect(() => {
    if (query.trim().length < SEARCH_MIN_LENGTH) {
      setResults([]); // eslint-disable-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++searchIdRef.current;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const q = query.trim();
      const canSee = (key: string | undefined) => visibility.canSeeCategory(key);
      const tasks: Promise<SearchResult[]>[] = [];

      if (canSee('nav.projects')) tasks.push(searchProjects(q, dataSource));
      if (canSee('nav.programs')) tasks.push(searchPrograms(q));
      if (canSee('nav.projects')) tasks.push(searchTasks(q, dataSource));
      if (canSee('nav.projects')) tasks.push(searchChecklistItems(q, dataSource));
      if (canSee('nav.projects')) tasks.push(searchNotes(q));
      if (canSee('nav.projects')) tasks.push(searchRisks(q, dataSource));
      if (canSee('nav.projects')) tasks.push(searchIssues(q, dataSource));
      if (canSee('nav.projects')) tasks.push(searchChanges(q, dataSource));
      if (canSee('nav.projects')) tasks.push(searchDecisions(q));
      if (canSee('nav.projects')) tasks.push(searchStatusReports(q, dataSource));
      if (canSee('nav.intakeQueue')) tasks.push(searchProjectRequests(q));
      if (visibility.canSeePayerContent) tasks.push(searchPayerIssues(q));
      if (visibility.canSeePayerContent) tasks.push(searchHpiIssues(q));
      if (visibility.isAdmin) tasks.push(searchUserFeedback(q));

      // Notifications: client-side filter of the already-fetched, already
      // user-scoped list — no extra query, never gated (always the viewer's own).
      const notifResults = searchNotifications(q, notifications);

      try {
        const settled = await Promise.all(tasks.map((p) => p.catch(() => [] as SearchResult[])));
        if (id !== searchIdRef.current) return;
        setResults([...settled.flat(), ...notifResults]);
      } finally {
        if (id === searchIdRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, dataSource, visibility.isAdmin, visibility.canSeePayerContent, visibility.allowedNavKeys, notifications]);

  const grouped = CATEGORY_ORDER
    .map((cat) => ({ cat, items: results.filter((r) => r.category === cat) }))
    .filter((g) => g.items.length > 0);

  const totalCount = results.length;
  const showHint = query.trim().length < SEARCH_MIN_LENGTH && !loading;
  const showNoMatches = !showHint && !loading && totalCount === 0 && query.trim().length >= SEARCH_MIN_LENGTH;

  function handleSelect(r: SearchResult) {
    setOpen(false);
    setQuery('');
    navigate(`${r.routePath}${r.routeSearch ?? ''}`);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative w-full max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Search the entire app…"
            autoComplete="off"
            className="w-full h-8 rounded-md border border-input bg-background pl-8 pr-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {loading && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 max-h-[70vh] overflow-y-auto"
        align="start"
        sideOffset={4}
        style={{ width: 'var(--radix-popover-trigger-width)', minWidth: 380 }}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {showHint && (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            Type {SEARCH_MIN_LENGTH}+ characters to search the entire app — projects, tasks,
            notes, risks, issues, decisions, intake requests, and more.
          </p>
        )}
        {showNoMatches && (
          <p className="px-3 py-4 text-sm text-muted-foreground">No matches for &ldquo;{query}&rdquo;.</p>
        )}
        {!showHint && !showNoMatches && grouped.length > 0 && (
          <div className="py-1">
            {grouped.map(({ cat, items }) => {
              const meta = CATEGORY_META[cat];
              const Icon = meta.icon;
              const visible = items.slice(0, SEARCH_DISPLAY_CAP);
              const hidden = items.length - visible.length;
              return (
                <div key={cat} className="border-b border-border/60 last:border-b-0 py-1">
                  <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                    <Icon className="h-3 w-3" /> {meta.label}
                  </p>
                  {visible.map((r) => (
                    <button
                      key={`${r.category}::${r.id}`}
                      type="button"
                      onClick={() => handleSelect(r)}
                      className={cn(
                        'w-full text-left px-3 py-1.5 text-sm hover:bg-muted/60 flex flex-col',
                      )}
                    >
                      <span className="text-foreground truncate">{r.label}</span>
                      {r.sublabel && (
                        <span className="text-xs text-muted-foreground truncate">{r.sublabel}</span>
                      )}
                    </button>
                  ))}
                  {hidden > 0 && (
                    <p className="px-3 py-1 text-[11px] text-muted-foreground italic">
                      {hidden} more — refine your search
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
