import { useEffect, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { Button } from '../ui/button';

interface ViewDetailPanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  /**
   * True when the panel holds unsaved edits.
   *
   * When set, clicking the backdrop or pressing Escape no longer discards the
   * work silently -- it calls `onDismissAttempt` so the host can ask first.
   * A CLEAN panel still closes instantly on both gestures, so the common case
   * gains no friction. Omit (or pass false) for read-only panels.
   */
  isDirty?: boolean;
  /**
   * Called instead of `onClose` when a backdrop click / Escape happens while
   * `isDirty` is true. Host shows its own confirm. If not supplied while dirty,
   * the gesture is IGNORED (fail safe: never throw away edits by accident).
   */
  onDismissAttempt?: () => void;
}

export function ViewDetailPanel({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  actions,
  isDirty = false,
  onDismissAttempt,
}: ViewDetailPanelProps) {
  // Single decision point for "user gestured to dismiss without using X/Save".
  // Clean -> close. Dirty -> hand off to the host, or ignore if it gave us no
  // handler (better a stuck panel than silently destroyed work).
  function requestDismiss() {
    if (!isDirty) {
      onClose();
      return;
    }
    onDismissAttempt?.();
  }

  // Escape used to do nothing here at all -- the panel had no key handling, so
  // Esc fell through to whatever was underneath. Now it follows the same rule
  // as the backdrop.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      requestDismiss();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isDirty, onDismissAttempt, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-[2px] z-40"
            onClick={requestDismiss}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%', opacity: 0.8 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320, mass: 0.8 }}
            className="fixed right-0 top-0 h-full w-full max-w-[480px] bg-card border-l border-border z-50 flex flex-col shadow-2xl"
          >
            {/* Edge accent */}
            <div className="absolute left-0 inset-y-0 w-px bg-gradient-to-b from-transparent via-primary/40 to-transparent pointer-events-none" />

            {/* Header */}
            <div className="flex-shrink-0 border-b border-border bg-muted/20 px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  {icon && (
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl avatar-brand">
                      {icon}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-foreground leading-tight truncate">{title}</h2>
                    {subtitle && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {actions}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onClose}
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
