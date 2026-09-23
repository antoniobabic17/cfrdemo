import { isValidElement, type ComponentType, type ReactElement } from 'react';
import { cn } from '../../lib/utils';

type AccentKey = 'primary' | 'blue' | 'amber' | 'rose' | 'emerald';

const ACCENT_STYLES: Record<AccentKey, {
  bar: string; icon: string; iconText: string;
}> = {
  primary: { bar: 'bg-primary',     icon: 'bg-primary/12',     iconText: 'text-primary' },
  blue:    { bar: 'bg-blue-500',    icon: 'bg-blue-500/12',    iconText: 'text-blue-500' },
  amber:   { bar: 'bg-amber-500',   icon: 'bg-amber-500/12',   iconText: 'text-amber-500' },
  rose:    { bar: 'bg-rose-500',    icon: 'bg-rose-500/12',    iconText: 'text-rose-500' },
  emerald: { bar: 'bg-emerald-500', icon: 'bg-emerald-500/12', iconText: 'text-emerald-500' },
};

interface KpiCardProps {
  label: string;
  value: string | number;
  icon?: ComponentType<{ className?: string }> | ReactElement;
  accent?: AccentKey;
  color?: string;
  secondary?: string;
  onClick?: () => void;
  trend?: { value: string; positive?: boolean };
}

function isReactComponent(v: unknown): v is ComponentType<{ className?: string }> {
  if (typeof v === 'function') return true;
  if (typeof v === 'object' && v !== null && '$$typeof' in v && 'render' in v) return true;
  return false;
}

export function KpiCard({
  label, value, icon, accent, color, secondary, onClick, trend,
}: KpiCardProps) {
  const accentStyle = accent ? ACCENT_STYLES[accent] : null;
  const accentColor = color ?? 'oklch(65% 0.25 295)';

  const isIconComp = icon && isReactComponent(icon);
  const isIconElement = icon && isValidElement(icon);
  const IconComp = isIconComp ? (icon as ComponentType<{ className?: string }>) : null;

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
      className={cn(
        'relative rounded-xl border border-border bg-card p-5 overflow-hidden flex flex-col gap-4',
        onClick && 'cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all',
      )}
    >
      {accentStyle ? (
        <div className={cn('absolute inset-x-0 top-0 h-0.5', accentStyle.bar)} />
      ) : (
        <div
          className="absolute inset-x-0 top-0 h-px pointer-events-none"
          style={{ background: `linear-gradient(90deg, transparent, ${accentColor}50, transparent)` }}
        />
      )}

      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[2.25rem] font-bold tracking-tight leading-none text-foreground tabular-nums">
            {value}
          </p>
        </div>
        {IconComp && accentStyle && (
          <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg shrink-0', accentStyle.icon, accentStyle.iconText)}>
            <IconComp className="h-5 w-5" />
          </div>
        )}
        {IconComp && !accentStyle && (
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0"
            style={{ backgroundColor: `${accentColor}18`, color: accentColor }}
          >
            <IconComp className="h-5 w-5" />
          </div>
        )}
        {isIconElement && (
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0"
            style={{ backgroundColor: `${accentColor}18`, color: accentColor }}
          >
            {icon as ReactElement}
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-semibold text-foreground leading-snug">{label}</p>
        {secondary && (
          <p className="text-xs text-muted-foreground mt-0.5">{secondary}</p>
        )}
        {trend && (
          <p className={cn('text-xs mt-1 font-medium', trend.positive ? 'text-emerald-400' : 'text-rose-400')}>
            {trend.value}
          </p>
        )}
      </div>
    </div>
  );
}
