import type { ComponentType } from 'react';
import { cn } from '../../lib/utils';

export interface SummaryItem {
  label: string;
  value: string | number;
  color?: string;
  icon?: ComponentType<{ className?: string }>;
}

interface SummaryStripProps {
  items: SummaryItem[];
  columns?: 2 | 3 | 4 | 5;
}

const COL_CLASS: Record<number, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
  5: 'grid-cols-2 md:grid-cols-5',
};

export function SummaryStrip({ items, columns = 4 }: SummaryStripProps) {
  return (
    <div className={cn('grid gap-3', COL_CLASS[columns])}>
      {items.map(({ label, value, color, icon: Icon }) => (
        <div key={label} className="rounded-lg border border-border bg-card px-4 py-3 text-center">
          {Icon && (
            <div className="flex justify-center mb-1">
              <Icon className={cn('h-4 w-4', color ?? 'text-muted-foreground')} />
            </div>
          )}
          <p className={cn('text-2xl font-bold tabular-nums', color ?? 'text-foreground')}>{value}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
        </div>
      ))}
    </div>
  );
}
