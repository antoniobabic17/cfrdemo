import { useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { Alert, AlertDescription } from '../ui/alert';
import { Button } from '../ui/button';

interface ErrorBannerProps {
  error: Error | null | undefined;
}

export function ErrorBanner({ error }: ErrorBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (!error || dismissed) return null;

  return (
    <Alert variant="destructive" className="mb-4">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription className="flex items-center justify-between">
        <span>{error.message}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss error"
        >
          <X className="h-3 w-3" />
        </Button>
      </AlertDescription>
    </Alert>
  );
}
