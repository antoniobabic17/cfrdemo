import { useState } from 'react';
import { ChevronDown, CheckCircle2, Clock } from 'lucide-react';
import { cn } from '../../lib/utils';
import { InitiationWorkspace } from './InitiationWorkspace';
import { GateWorkspace } from './GateWorkspace';
import { CloseoutWorkspace } from './CloseoutWorkspace';
import { useCloseoutReadiness } from '../../hooks/useProjectCloseout';

interface GovernWorkspaceProps {
  projectId: string;
  projectStage?: string;
  onEditProject: () => void;
  canEdit: boolean;
}

function CollapsibleSection({
  title, defaultOpen, badge, children,
}: {
  title: string; defaultOpen: boolean; badge?: React.ReactNode; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {badge}
        </div>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform duration-200', open ? 'rotate-0' : '-rotate-90')} />
      </button>
      {open && (
        <div className="border-t border-border/60 px-5 py-4">
          {children}
        </div>
      )}
    </div>
  );
}

export function GovernWorkspace({ projectId, projectStage, onEditProject, canEdit }: GovernWorkspaceProps) {
  const { total: closeoutTotal, done: closeoutDone } = useCloseoutReadiness(projectId);
  const stage = (projectStage ?? '').toLowerCase();

  const initiationComplete = false; // Will be driven by data — for now always expanded
  const allGatesPassed = false;
  const isCloseoutStage = stage.includes('closeout') || stage.includes('close');

  const initiationOpen = !initiationComplete;
  const gatesOpen = true;
  const closeoutOpen = isCloseoutStage || allGatesPassed;

  return (
    <div className="space-y-4">
      <CollapsibleSection
        title="Initiation Readiness"
        defaultOpen={initiationOpen}
        badge={
          initiationComplete ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
              <CheckCircle2 className="h-3 w-3" />Complete
            </span>
          ) : undefined
        }
      >
        <InitiationWorkspace projectId={projectId} onEditProject={onEditProject} canEdit={canEdit} />
      </CollapsibleSection>

      <CollapsibleSection
        title="Lifecycle Gates"
        defaultOpen={gatesOpen}
      >
        <GateWorkspace projectId={projectId} />
      </CollapsibleSection>

      <CollapsibleSection
        title="Closeout"
        defaultOpen={closeoutOpen}
        badge={
          closeoutTotal > 0 ? (
            <span className={cn(
              'inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full',
              closeoutDone >= closeoutTotal
                ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                : 'text-muted-foreground bg-muted/50'
            )}>
              {closeoutDone >= closeoutTotal ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
              {closeoutDone}/{closeoutTotal} dimensions
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Not started</span>
          )
        }
      >
        <CloseoutWorkspace projectId={projectId} />
      </CollapsibleSection>
    </div>
  );
}
