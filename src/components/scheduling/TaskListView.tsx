import { cn } from '../../lib/utils';
import { DataTable, type DataTableColumn } from '../data-table';
import type { ProjectTask } from '../../models/projectTask.model';
import { getDisplayProgressPct } from '../../models/projectTask.model';
import type { TaskAssignee } from './TaskRow';
import { TASK_PRIORITY_META, TASK_PRIORITY } from '../../lib/constants';
import { deriveTaskStatus, STATUS_META, STATUS_ORDER } from '../../lib/taskStatus';
import { TaskCompletionCheckbox } from './TaskCompletionCheckbox';

function fmtDate(iso: string | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

interface Props {
  useNewResourceModel?: boolean;
  tasks: ProjectTask[];
  assignmentMap: Map<string, TaskAssignee[]>;
  onSelectTask: (taskId: string) => void;
  projectId: string;
  canEdit?: boolean;
}

export function TaskListView({ tasks, assignmentMap, onSelectTask, projectId, canEdit = true, useNewResourceModel = false }: Props) {
  const columns: DataTableColumn<ProjectTask>[] = [
    {
      key: 'complete',
      header: '',
      render: (t) => (
        <div onClick={(e) => e.stopPropagation()}>
          <TaskCompletionCheckbox task={t} projectId={projectId} disabled={!canEdit} useNewResourceModel={useNewResourceModel} assignees={assignmentMap.get(t.msdyn_projecttaskid) ?? []} />
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      // Sort by enum order so Not Started -> In Progress -> At Risk -> Overdue -> Done.
      getValue: (t) => STATUS_ORDER.indexOf(deriveTaskStatus(t)),
      render: (t) => {
        const meta = STATUS_META[deriveTaskStatus(t)];
        return (
          <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', meta.pillCls)}>
            {meta.label}
          </span>
        );
      },
    },
    {
      key: 'pmo_taskid',
      header: 'Task ID',
      sortable: true,
      getValue: (t) => t.pmo_taskid ?? '',
      render: (t) =>
        t.pmo_taskid ? (
          <span className="font-mono text-xs tabular-nums text-foreground">{t.pmo_taskid}</span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      key: 'msdyn_subject',
      header: 'Task',
      sortable: true,
      getValue: (t) => t.msdyn_subject,
      render: (t) => {
        const status = deriveTaskStatus(t);
        return (
          <div>
            <span className={cn(
              'text-sm font-medium',
              t.msdyn_summary && 'font-semibold',
              status === 'done' && 'line-through text-muted-foreground',
            )}>
              {t.msdyn_subject}
            </span>
            {t.msdyn_summary && <span className="ml-1.5 text-[10px] text-muted-foreground">(summary)</span>}
            {t.msdyn_ismilestone && <span className="ml-1.5 text-[10px] text-amber-600">★ Milestone</span>}
          </div>
        );
      },
    },
    {
      key: 'priority',
      header: 'Priority',
      sortable: true,
      getValue: (t) => t.msdyn_priority ?? TASK_PRIORITY.Medium,
      render: (t) => {
        const p = t.msdyn_priority ?? TASK_PRIORITY.Medium;
        const meta = TASK_PRIORITY_META[p] ?? TASK_PRIORITY_META[TASK_PRIORITY.Medium];
        return (
          <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded', meta.cls)}>
            {meta.label}
          </span>
        );
      },
    },
    {
      key: 'progress',
      header: 'Progress',
      sortable: true,
      getValue: (t) => getDisplayProgressPct(t),
      render: (t) => {
        const status = deriveTaskStatus(t);
        const pct = getDisplayProgressPct(t);
        return t.msdyn_summary ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <div className="flex items-center gap-2 min-w-[80px]">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn('h-full rounded-full', status === 'done' ? 'bg-emerald-500' : 'bg-primary')}
                style={{ width: `${Math.round(pct)}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground w-6 text-right shrink-0">{Math.round(pct)}%</span>
          </div>
        );
      },
    },
    {
      key: 'assignees',
      header: 'Assignees',
      render: (t) => {
        const a = assignmentMap.get(t.msdyn_projecttaskid) ?? [];
        return a.length > 0 ? (
          <div className="flex gap-1 flex-wrap">
            {a.map((x) => (
              <span key={x.assignmentId} title={x.name} className="text-[10px] font-semibold bg-primary/10 text-primary rounded-full px-1.5 py-0.5">
                {initials(x.name)}
              </span>
            ))}
          </div>
        ) : <span className="text-muted-foreground text-xs">—</span>;
      },
    },
    {
      key: 'msdyn_scheduledstart',
      header: 'Start',
      sortable: true,
      getValue: (t) => t.msdyn_scheduledstart ?? '',
      render: (t) => <span className="text-xs text-muted-foreground">{fmtDate(t.msdyn_scheduledstart)}</span>,
    },
    {
      key: 'due',
      header: 'Due',
      sortable: true,
      getValue: (t) => t.msdyn_scheduledend ?? t.msdyn_finish ?? '',
      render: (t) => {
        const due = t.msdyn_scheduledend ?? t.msdyn_finish;
        const status = deriveTaskStatus(t);
        const isOverdue = status === 'overdue';
        return (
          <span className={cn('text-xs', isOverdue ? 'text-rose-500 font-medium' : 'text-muted-foreground')}>
            {fmtDate(due)}
            {isOverdue && ' ⚠'}
          </span>
        );
      },
    },
  ];

  return (
    <DataTable
      data={tasks}
      columns={columns}
      keyExtractor={(t) => t.msdyn_projecttaskid}
      onRowClick={(t) => onSelectTask(t.msdyn_projecttaskid)}
      // Colored left border per row via border-l-4 + the status border color.
      rowClassName={(t) => cn('border-l-4', STATUS_META[deriveTaskStatus(t)].borderCls, STATUS_META[deriveTaskStatus(t)].bgCls)}
      emptyMessage="No tasks match the current filters."
      searchPlaceholder="Search tasks…"
      searchFn={(t, q) => t.msdyn_subject.toLowerCase().includes(q.toLowerCase())}
    />
  );
}
