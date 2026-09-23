import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { TASK_PRIORITY_OPTIONS } from '../../lib/constants';
import { labelColorClass, labelNameFor } from '../../lib/labelPalette';
import type { TaskAssignee, TaskTeamMember } from './TaskRow';
import type { ProjectLabel } from '../../models/projectLabel.model';

export interface TaskFilters {
  assigneeIds: string[];
  priorities: number[];  // values: 1=Urgent, 3=Important, 5=Medium, 9=Low
  progressStates: Array<'not_started' | 'in_progress' | 'complete'>;
  dueDateRange: 'all' | 'overdue' | 'this_week' | 'this_month';
  labelIds: string[];
}

export const EMPTY_FILTERS: TaskFilters = {
  assigneeIds: [],
  priorities: [],
  progressStates: [],
  dueDateRange: 'all',
  labelIds: [],
};

export function hasActiveFilters(f: TaskFilters): boolean {
  return (
    f.assigneeIds.length > 0 ||
    f.priorities.length > 0 ||
    f.progressStates.length > 0 ||
    f.dueDateRange !== 'all' ||
    f.labelIds.length > 0
  );
}


const PROGRESS_OPTIONS: Array<{ key: TaskFilters['progressStates'][number]; label: string }> = [
  { key: 'not_started', label: 'Not started' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'complete', label: 'Complete' },
];

const DUE_OPTIONS: Array<{ key: TaskFilters['dueDateRange']; label: string }> = [
  { key: 'all', label: 'Any date' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'this_week', label: 'This week' },
  { key: 'this_month', label: 'This month' },
];

interface Props {
  filters: TaskFilters;
  teamMembers: TaskTeamMember[];
  assignments: TaskAssignee[];
  projectLabels?: ProjectLabel[];
  onChange: (filters: TaskFilters) => void;
  onClear: () => void;
}

export function TaskFilterBar({ filters, teamMembers, onChange, onClear, projectLabels = [] }: Props) {
  function toggleAssignee(id: string) {
    const next = filters.assigneeIds.includes(id)
      ? filters.assigneeIds.filter((x) => x !== id)
      : [...filters.assigneeIds, id];
    onChange({ ...filters, assigneeIds: next });
  }

  function togglePriority(p: number) {
    const next = filters.priorities.includes(p)
      ? filters.priorities.filter((x) => x !== p)
      : [...filters.priorities, p];
    onChange({ ...filters, priorities: next });
  }

  function toggleProgress(s: TaskFilters['progressStates'][number]) {
    const next = filters.progressStates.includes(s)
      ? filters.progressStates.filter((x) => x !== s)
      : [...filters.progressStates, s];
    onChange({ ...filters, progressStates: next });
  }

  function toggleLabel(id: string) {
    const next = filters.labelIds.includes(id)
      ? filters.labelIds.filter((x) => x !== id)
      : [...filters.labelIds, id];
    onChange({ ...filters, labelIds: next });
  }

  const active = hasActiveFilters(filters);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2 px-0.5">

      {/* Assignee chips */}
      {teamMembers.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest shrink-0">Assignee</span>
          {teamMembers.map((m) => {
            const selected = filters.assigneeIds.includes(m.id);
            return (
              <button
                key={m.id}
                onClick={() => toggleAssignee(m.id)}
                className={cn(
                  'text-[11px] px-2 py-0.5 rounded-full border transition-colors',
                  selected
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:border-primary hover:text-foreground',
                )}
              >
                {m.name.split(' ')[0]}
              </button>
            );
          })}
        </div>
      )}

      {/* Priority chips — 1=Urgent, 3=Important, 5=Medium, 9=Low */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest shrink-0">Priority</span>
        {TASK_PRIORITY_OPTIONS.map(({ value, label, cls }) => {
          const selected = filters.priorities.includes(value);
          return (
            <button
              key={value}
              onClick={() => togglePriority(value)}
              className={cn(
                'text-[11px] px-2 py-0.5 rounded-full border transition-colors',
                selected ? cn(cls, 'font-semibold border-transparent') : 'border-border text-muted-foreground hover:border-primary hover:text-foreground',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Progress chips */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest shrink-0">Progress</span>
        {PROGRESS_OPTIONS.map(({ key, label }) => {
          const selected = filters.progressStates.includes(key);
          return (
            <button
              key={key}
              onClick={() => toggleProgress(key)}
              className={cn(
                'text-[11px] px-2 py-0.5 rounded-full border transition-colors',
                selected
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:border-primary hover:text-foreground',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Due date select */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest shrink-0">Due</span>
        <select
          value={filters.dueDateRange}
          onChange={(e) => onChange({ ...filters, dueDateRange: e.target.value as TaskFilters['dueDateRange'] })}
          className="text-[11px] border border-border rounded px-1.5 py-0.5 bg-muted/20 outline-none focus:border-primary"
        >
          {DUE_OPTIONS.map(({ key, label }) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {/* Label chips */}
      {projectLabels.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest shrink-0">Labels</span>
          {projectLabels.map((label) => {
            const selected = filters.labelIds.includes(label.msdyn_projectlabelid);
            const name = labelNameFor(label.msdyn_projectlabeltext, label.msdyn_colorindex);
            return (
              <button
                key={label.msdyn_projectlabelid}
                onClick={() => toggleLabel(label.msdyn_projectlabelid)}
                className={cn(
                  'text-[11px] px-2 py-0.5 rounded-full border transition-all',
                  selected
                    ? cn(labelColorClass(label.msdyn_colorindex), 'border-transparent font-semibold')
                    : 'border-border text-muted-foreground hover:border-primary hover:text-foreground',
                )}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}

      {/* Clear */}
      {active && (
        <button
          onClick={onClear}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors ml-auto"
        >
          <X className="h-3 w-3" /> Clear filters
        </button>
      )}
    </div>
  );
}
