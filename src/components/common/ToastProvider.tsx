import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useToastListener, type Toast } from '../../hooks/useToast';

const typeStyles: Record<Toast['type'], string> = {
  success: 'bg-emerald-600 text-white',
  error: 'bg-rose-100 text-rose-900 border border-rose-300',
  info: 'bg-primary text-primary-foreground',
  warning: 'bg-amber-100 text-amber-900 border border-amber-300',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { toasts, subscribe, dismiss } = useToastListener();

  useEffect(subscribe, [subscribe]);

  return (
    <>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-lg px-4 py-3 shadow-lg text-sm flex items-start gap-2 animate-in slide-in-from-bottom-2 ${typeStyles[t.type]}`}
          >
            <span className="flex-1 whitespace-pre-line">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 opacity-70 hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
