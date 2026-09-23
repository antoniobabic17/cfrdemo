import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { useCreateProjectDecision } from '../../hooks/useProjectDecisions';
import { DECISION_STATUS } from '../../lib/constants';
import { toast } from '../../hooks/useToast';
import { toDataverseDateOnly, todayLocalYmd } from '../../lib/dateOnly';

interface MeetingActionCaptureProps {
  projectId: string;
  meetingLinkId?: string;
}

export function MeetingActionCapture({ projectId, meetingLinkId }: MeetingActionCaptureProps) {
  const [open, setOpen] = useState(false);
  const [actionName, setActionName] = useState('');
  const [actionDesc, setActionDesc] = useState('');
  const createDecision = useCreateProjectDecision(projectId);

  async function handleCapture() {
    if (!actionName.trim()) return;
    const payload: Record<string, unknown> = {
      pmo_name: actionName.trim(),
      pmo_description: actionDesc.trim() || actionName.trim(),
      pmo_decisiondate: toDataverseDateOnly(todayLocalYmd())!,
      pmo_status: DECISION_STATUS.Proposed,
      'pmo_Project@odata.bind': `/msdyn_projects(${projectId})`,
    };
    if (meetingLinkId) {
      payload['pmo_MeetingLink@odata.bind'] = `/pmo_projectmeetinglinks(${meetingLinkId})`;
    }
    await createDecision.mutateAsync(payload as Parameters<typeof createDecision.mutateAsync>[0]);
    toast.success('Action captured as decision');
    setOpen(false);
    setActionName('');
    setActionDesc('');
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5 mr-1" />
        Capture Action
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Capture Meeting Action</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Action Item</label>
              <Input value={actionName} onChange={(e) => setActionName(e.target.value)} placeholder="Action description" />
            </div>
            <div>
              <label className="text-sm font-medium">Details (optional)</label>
              <textarea
                value={actionDesc}
                onChange={(e) => setActionDesc(e.target.value)}
                rows={3}
                placeholder="Additional context"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <Button size="sm" onClick={handleCapture} disabled={createDecision.isPending || !actionName.trim()}>
              {createDecision.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Capture
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
