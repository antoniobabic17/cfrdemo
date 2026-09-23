import type { ReactElement } from 'react';

interface EmptyStateProps {
  message: string;
  icon?: ReactElement;
}

export function EmptyState({ message, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground" role="status">
      {icon && <span className="text-5xl opacity-50">{icon}</span>}
      <p className="text-base">{message}</p>
    </div>
  );
}
