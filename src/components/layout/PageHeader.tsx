import { ArrowLeft } from 'lucide-react';
import { Button } from '../ui/button';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, showBack, onBack, actions }: PageHeaderProps) {
  return (
    <div className="flex items-center gap-3 pb-5 border-b border-border mb-6">
      {showBack && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Go back"
          className="shrink-0 h-8 w-8 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
      )}
      <div className="flex-1 min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-foreground truncate">{title}</h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex gap-2 items-center shrink-0">{actions}</div>}
    </div>
  );
}
