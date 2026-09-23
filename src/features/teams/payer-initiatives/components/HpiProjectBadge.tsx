/**
 * Slot component for 'project.detail.afterHeader'.
 *
 * Shows the HPI linked to this project as an inline badge with a link to
 * the HPI gallery drawer and an unlink button. If no HPI is linked and the
 * user can edit, shows a compact picker to attach one.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Link2, Unlink, ExternalLink, Loader2, Tag } from 'lucide-react';
import { Button } from '../../../../components/ui/button';
import { toast } from '../../../../hooks/useToast';
import { useHpiIssues, useRelateProjectToHpi } from '../hooks/useHpiIssues';
import { hpiDetailHref } from '../constants';
import { hpiDisplayName } from '../api/hpi.api';
import type { SlotProps } from '../../_shared/types';

interface HpiProjectBadgeProps {
  projectId: string;
  hpiId?: string;
  hpiLabel?: string;
  canEdit?: boolean;
}

export function HpiProjectBadge(rawProps: SlotProps) {
  const { projectId, hpiId, hpiLabel, canEdit } = rawProps as unknown as HpiProjectBadgeProps;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const relate = useRelateProjectToHpi();
  const [picking, setPicking] = useState(false);
  const { data: allHpis = [] } = useHpiIssues();

  async function handleUnlink() {
    if (!projectId || !hpiId) return;
    try {
      await relate.mutateAsync({ projectId, hpiId: null });
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success('HPI unlinked from project.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Couldn't unlink: ${msg}`);
    }
  }

  async function handleLink(selectedHpiId: string) {
    if (!projectId) return;
    try {
      await relate.mutateAsync({ projectId, hpiId: selectedHpiId });
      qc.invalidateQueries({ queryKey: ['projects'] });
      setPicking(false);
      toast.success('HPI linked to project.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Couldn't link: ${msg}`);
    }
  }

  if (!projectId) return null;

  if (hpiId) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <Tag className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-xs text-muted-foreground">HPI:</span>
        <span className="text-xs font-medium text-foreground truncate">
          {hpiLabel || hpiId}
        </span>
        <Button
          variant="ghost" size="sm" className="h-6 px-1.5 ml-auto"
          title="Open in HPI gallery"
          onClick={() => navigate(hpiDetailHref(hpiId))}
        >
          <ExternalLink className="h-3 w-3" />
        </Button>
        {canEdit && (
          <Button
            variant="ghost" size="sm" className="h-6 px-1.5 text-rose-600 hover:text-rose-700"
            title="Unlink HPI"
            onClick={handleUnlink}
            disabled={relate.isPending}
          >
            {relate.isPending
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Unlink className="h-3 w-3" />}
          </Button>
        )}
      </div>
    );
  }

  if (!canEdit) return null;

  return (
    <div className="flex items-center gap-2">
      {picking ? (
        <>
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs flex-1 max-w-xs"
            defaultValue=""
            onChange={(e) => { if (e.target.value) handleLink(e.target.value); }}
          >
            <option value="">Select an HPI…</option>
            {allHpis.map((h) => (
              <option key={h.rcm_payerdeckissueid} value={h.rcm_payerdeckissueid}>
                {h.rcm_issuenumber ? `${h.rcm_issuenumber} — ` : ''}{hpiDisplayName(h)}
              </option>
            ))}
          </select>
          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setPicking(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setPicking(true)}>
          <Link2 className="h-3.5 w-3.5" />
          Link HPI
        </Button>
      )}
    </div>
  );
}
