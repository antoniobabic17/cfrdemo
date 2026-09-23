import { cn } from '../../lib/utils';

interface Bar {
  label: string;
  count: number;
  color: string;
}

interface BarSectionProps {
  title: string;
  bars: Bar[];
  emptyLabel: string;
}

export function BarSection({ title, bars, emptyLabel }: BarSectionProps) {
  const maxCount = Math.max(...bars.map((b) => b.count), 1);
  const total = bars.reduce((s, b) => s + b.count, 0);
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-sm font-semibold text-foreground mb-4">{title}</h2>
      {total === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="space-y-3">
          {bars.map(({ label, count, color }) => (
            <div key={label}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-foreground">{label}</span>
                <span className="text-xs font-bold tabular-nums text-foreground">{count}</span>
              </div>
              <div className="h-6 rounded-md bg-muted overflow-hidden">
                <div
                  className={cn('h-full rounded-md transition-all', color)}
                  style={{ width: `${Math.max((count / maxCount) * 100, count > 0 ? 3 : 0)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
