import { cn } from '../../lib/utils';
import { OVERALL_HEALTH } from '../../lib/constants';

const HEALTH_STYLES: Record<number, { bg: string; text: string; dot: string; ring: string; label: string }> = {
  [OVERALL_HEALTH.OnTrack]:  { bg: 'bg-emerald-500/12', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500 dark:bg-emerald-400', ring: 'ring-emerald-500/20', label: 'On Track' },
  [OVERALL_HEALTH.AtRisk]:   { bg: 'bg-amber-500/12',   text: 'text-amber-700 dark:text-amber-300',     dot: 'bg-amber-500 dark:bg-amber-400',   ring: 'ring-amber-500/20',   label: 'At Risk' },
  [OVERALL_HEALTH.OffTrack]: { bg: 'bg-rose-500/12',    text: 'text-rose-700 dark:text-rose-300',       dot: 'bg-rose-500 dark:bg-rose-400',     ring: 'ring-rose-500/20',    label: 'Off Track' },
};

interface HealthBadgeProps {
  value?: number;
  size?: 'sm' | 'md';
  showDot?: boolean;
}

export function HealthBadge({ value, size = 'md', showDot = true }: HealthBadgeProps) {
  if (value == null) return <span className="text-muted-foreground text-xs">—</span>;
  const style = HEALTH_STYLES[value];
  if (!style) return <span className="text-muted-foreground text-xs">—</span>;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-semibold ring-1',
        style.bg, style.text, style.ring,
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-xs',
      )}
    >
      {showDot && <span className={cn('rounded-full shrink-0', style.dot, size === 'sm' ? 'h-1.5 w-1.5' : 'w-1.5 h-1.5')} />}
      {style.label}
    </span>
  );
}
