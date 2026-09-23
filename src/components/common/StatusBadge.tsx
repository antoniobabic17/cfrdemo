import { cn } from '../../lib/utils';

// text uses dark: pairs: base = light-mode high-contrast, dark: = original pastel
const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string; ring: string }> = {
  active:        { bg: 'bg-emerald-500/12', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500 dark:bg-emerald-400 dark:shadow-[0_0_4px_oklch(72%_0.2_160)]', ring: 'ring-emerald-500/20' },
  inactive:      { bg: 'bg-slate-500/12',   text: 'text-slate-600 dark:text-slate-400',     dot: 'bg-slate-500 dark:bg-slate-400',                                               ring: 'ring-slate-500/20' },
  pending:       { bg: 'bg-amber-500/12',   text: 'text-amber-700 dark:text-amber-300',     dot: 'bg-amber-500 dark:bg-amber-400 dark:shadow-[0_0_4px_oklch(80%_0.2_80)]',      ring: 'ring-amber-500/20' },
  expired:       { bg: 'bg-rose-500/12',    text: 'text-rose-700 dark:text-rose-300',       dot: 'bg-rose-500 dark:bg-rose-400',                                                 ring: 'ring-rose-500/20' },
  draft:         { bg: 'bg-blue-500/12',    text: 'text-blue-700 dark:text-blue-300',       dot: 'bg-blue-500 dark:bg-blue-400',                                                 ring: 'ring-blue-500/20' },
  approved:      { bg: 'bg-emerald-500/12', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500 dark:bg-emerald-400 dark:shadow-[0_0_4px_oklch(72%_0.2_160)]', ring: 'ring-emerald-500/20' },
  rejected:      { bg: 'bg-rose-500/12',    text: 'text-rose-700 dark:text-rose-300',       dot: 'bg-rose-500 dark:bg-rose-400',                                                 ring: 'ring-rose-500/20' },
  withdrawn:     { bg: 'bg-slate-500/12',   text: 'text-slate-600 dark:text-slate-400',     dot: 'bg-slate-500 dark:bg-slate-400',                                               ring: 'ring-slate-500/20' },
  open:          { bg: 'bg-blue-500/12',    text: 'text-blue-700 dark:text-blue-300',       dot: 'bg-blue-500 dark:bg-blue-400',                                                 ring: 'ring-blue-500/20' },
  collected:     { bg: 'bg-emerald-500/12', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500 dark:bg-emerald-400 dark:shadow-[0_0_4px_oklch(72%_0.2_160)]', ring: 'ring-emerald-500/20' },
  'written off': { bg: 'bg-rose-500/12',    text: 'text-rose-700 dark:text-rose-300',       dot: 'bg-rose-500 dark:bg-rose-400',                                                 ring: 'ring-rose-500/20' },
  'in progress': { bg: 'bg-amber-500/12',   text: 'text-amber-700 dark:text-amber-300',     dot: 'bg-amber-500 dark:bg-amber-400 dark:shadow-[0_0_4px_oklch(80%_0.2_80)]',      ring: 'ring-amber-500/20' },
  'not started': { bg: 'bg-slate-500/12',   text: 'text-slate-600 dark:text-slate-400',     dot: 'bg-slate-500 dark:bg-slate-400',                                               ring: 'ring-slate-500/20' },
  completed:     { bg: 'bg-emerald-500/12', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500 dark:bg-emerald-400 dark:shadow-[0_0_4px_oklch(72%_0.2_160)]', ring: 'ring-emerald-500/20' },
  'on hold':     { bg: 'bg-orange-500/12',  text: 'text-orange-700 dark:text-orange-300',   dot: 'bg-orange-500 dark:bg-orange-400',                                             ring: 'ring-orange-500/20' },
  terminated:    { bg: 'bg-rose-500/12',    text: 'text-rose-700 dark:text-rose-300',       dot: 'bg-rose-500 dark:bg-rose-400',                                                 ring: 'ring-rose-500/20' },
};

interface StatusBadgeProps {
  status?: string;
  label?: string;
  showDot?: boolean;
  statecode?: 0 | 1;
}

export function StatusBadge({ status, label, showDot = true, statecode }: StatusBadgeProps) {
  const resolvedStatus =
    statecode !== undefined
      ? statecode === 0
        ? 'active'
        : 'inactive'
      : (status ?? 'inactive').toLowerCase();

  const resolvedLabel =
    label ??
    (statecode !== undefined
      ? statecode === 0
        ? 'Active'
        : 'Inactive'
      : (status ?? 'Inactive'));

  const style = STATUS_STYLES[resolvedStatus] ?? STATUS_STYLES.inactive;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1',
        style.bg,
        style.text,
        style.ring
      )}
    >
      {showDot && <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', style.dot)} />}
      {resolvedLabel}
    </span>
  );
}
