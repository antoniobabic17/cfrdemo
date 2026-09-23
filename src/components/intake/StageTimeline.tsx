import { Check, AlertTriangle, Clock } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { GateSetItem } from '../../models/gateSetTemplate.model';

interface StageTimelineProps {
  stages: GateSetItem[];
  currentStageNumber: number;
  status: number;
}

export function StageTimeline({ stages, currentStageNumber, status }: StageTimelineProps) {
  const sorted = [...stages].sort((a, b) => a.pmo_gateorder - b.pmo_gateorder);

  function getStageState(index: number): 'completed' | 'current' | 'sent_back' | 'future' {
    if (index < currentStageNumber) return 'completed';
    if (index === currentStageNumber) {
      if (status === 893460026) return 'sent_back';
      return 'current';
    }
    return 'future';
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2">
      {sorted.map((stage, i) => {
        const state = getStageState(i);
        const label = stage.pmo_stagelabel || stage.pmo_name || `Stage ${i + 1}`;

        return (
          <div key={stage.pmo_gatesetitemid} className="flex items-center gap-1 shrink-0">
            <div className="flex flex-col items-center gap-0.5">
              <div className={cn(
                'flex items-center justify-center w-8 h-8 rounded-full border-2 text-xs font-bold transition-colors',
                state === 'completed' ? 'bg-emerald-500 border-emerald-500 text-white' :
                state === 'current' ? 'bg-primary border-primary text-primary-foreground animate-pulse' :
                state === 'sent_back' ? 'bg-amber-500 border-amber-500 text-white' :
                'bg-muted border-border text-muted-foreground',
              )}>
                {state === 'completed' ? <Check className="h-4 w-4" /> :
                 state === 'sent_back' ? <AlertTriangle className="h-4 w-4" /> :
                 state === 'current' ? <Clock className="h-4 w-4" /> :
                 i + 1}
              </div>
              <span className={cn('text-[10px] max-w-[80px] text-center truncate',
                state === 'current' || state === 'sent_back' ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}>
                {label}
              </span>
            </div>
            {i < sorted.length - 1 && (
              <div className={cn(
                'h-0.5 w-6 rounded-full shrink-0',
                i < currentStageNumber ? 'bg-emerald-500' : 'bg-border',
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}
