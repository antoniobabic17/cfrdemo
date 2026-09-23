import { Loader2 } from 'lucide-react';

interface LoadingOverlayProps {
  isLoading: boolean;
  label?: string;
}

export function LoadingOverlay({ isLoading, label = 'Loading...' }: LoadingOverlayProps) {
  if (!isLoading) return null;
  return (
    <div className="flex justify-center items-center py-12" role="status">
      <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}
