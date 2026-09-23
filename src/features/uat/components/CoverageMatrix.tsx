/**
 * CoverageMatrix — requirements against their coverage, with the gaps impossible to miss.
 *
 * **An untested requirement must be visually distinguishable from a fully tested one**, and not
 * only by colour: each state carries its own word AND its own shape, because a red/green pair is
 * indistinguishable to a red-green colour-blind reader and a coverage report exists to be
 * skimmed. So every row shows the state's label, and the colour reinforces it rather than
 * carrying it alone.
 *
 * **The percentage comes from `uatCoverage.ts`**, which counts rows the caller already read —
 * never from a Dataverse aggregate, because two-hop navigation filters and `countdistinct`
 * return wrong answers with an HTTP 200 here. This component does no arithmetic of its own; if
 * it did, there would be two coverage figures in the app.
 */
import { useMemo } from 'react';
import { AlertTriangle, CircleSlash, Clock, CheckCircle2, MinusCircle } from 'lucide-react';
import {
  coverageSummary,
  requirementTree,
  COVERAGE_STATE_LABELS,
  COVERAGE_STATES_WORST_FIRST,
  type CoverageLink,
  type CoverageState,
  type CoverageTestCase,
} from '../lib/uatCoverage';

/** A requirement as the matrix needs it. */
export interface MatrixRequirement {
  requirementId: string;
  name: string;
  title: string;
  parentId?: string | null;
}

/**
 * The visual per state: an icon shape and a colour class.
 *
 * A shape per state, so the matrix is readable without colour at all. The icons are chosen to
 * mean something on their own — a warning triangle for failing, a struck-through circle for not
 * covered, a clock for not yet run.
 */
const STATE_VISUAL: Record<CoverageState, { Icon: typeof AlertTriangle; className: string }> = {
  failing: { Icon: AlertTriangle, className: 'text-rose-700' },
  uncovered: { Icon: CircleSlash, className: 'text-rose-600' },
  planned: { Icon: Clock, className: 'text-amber-700' },
  partial: { Icon: MinusCircle, className: 'text-amber-600' },
  covered: { Icon: CheckCircle2, className: 'text-emerald-700' },
};

export interface CoverageMatrixProps {
  requirements: readonly MatrixRequirement[];
  links: readonly CoverageLink[];
  cases: readonly CoverageTestCase[];
  onRequirementClick?: (requirementId: string) => void;
}

export function CoverageMatrix({
  requirements,
  links,
  cases,
  onRequirementClick,
}: CoverageMatrixProps) {
  const summary = useMemo(
    () => coverageSummary(requirements, links, cases),
    [requirements, links, cases],
  );
  const stateById = useMemo(
    () => new Map(summary.byRequirement.map((r) => [r.requirementId, r])),
    [summary],
  );
  const tree = useMemo(() => requirementTree(requirements), [requirements]);

  if (requirements.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No requirements recorded yet. Coverage is measured against requirements, so there is
        nothing to measure.
      </p>
    );
  }

  return (
    <div className="space-y-4" data-testid="uat-coverage-matrix">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <p className="text-sm">
          <span className="text-2xl font-semibold tabular-nums" data-testid="uat-coverage-percent">
            {summary.percentVerified === null ? '—' : `${summary.percentVerified}%`}
          </span>{' '}
          <span className="text-muted-foreground">
            verified ({summary.counts.covered} of {summary.requirementCount})
          </span>
        </p>
        {/* The legend doubles as the count per state, so the number and its meaning are in one
            place rather than in a tooltip somebody has to find. */}
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid="uat-coverage-legend">
          {COVERAGE_STATES_WORST_FIRST.map((state) => {
            const { Icon, className } = STATE_VISUAL[state];
            return (
              <li key={state} className="flex items-center gap-1.5">
                <Icon className={`h-3.5 w-3.5 ${className}`} aria-hidden />
                <span className="text-muted-foreground">
                  {COVERAGE_STATE_LABELS[state]}: <span className="tabular-nums">{summary.counts[state]}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="rounded-md border border-border overflow-x-auto">
        <table className="w-full text-sm" data-testid="uat-coverage-rows">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-3 py-2 w-28">Requirement</th>
              <th className="text-left px-3 py-2">Title</th>
              <th className="text-left px-3 py-2 w-48">Coverage</th>
              <th className="text-right px-3 py-2 w-24">Tests</th>
            </tr>
          </thead>
          <tbody>
            {tree.flatMap((node) => [node.requirement, ...node.children]).map((requirement) => {
              const coverage = stateById.get(requirement.requirementId);
              const state = coverage?.state ?? 'uncovered';
              const { Icon, className } = STATE_VISUAL[state];
              const isChild = !!requirement.parentId
                && requirements.some((r) => r.requirementId === requirement.parentId);
              return (
                <tr
                  key={requirement.requirementId}
                  className={`border-t border-border ${onRequirementClick ? 'cursor-pointer hover:bg-muted/40' : ''}`}
                  onClick={() => onRequirementClick?.(requirement.requirementId)}
                >
                  <td className="px-3 py-1.5 tabular-nums">{requirement.name}</td>
                  <td className={`px-3 py-1.5 ${isChild ? 'pl-8 text-muted-foreground' : ''}`}>
                    {requirement.title}
                  </td>
                  <td className="px-3 py-1.5">
                    {/* Icon AND word. The word is what makes this readable without colour, and
                        a coverage report that needs colour to be read is a report that misleads
                        one reader in twelve. */}
                    <span className={`inline-flex items-center gap-1.5 ${className}`}>
                      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {COVERAGE_STATE_LABELS[state]}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {coverage?.linkCount ?? 0}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default CoverageMatrix;
