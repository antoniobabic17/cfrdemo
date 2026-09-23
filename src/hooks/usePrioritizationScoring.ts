import { useMemo } from 'react';
import type { Project } from '../models/project.model';
import { COMPLEXITY, STRATEGIC_PRIORITY, OVERALL_HEALTH } from '../lib/constants';
import { usePrioritizationWeights, usePrioritizationBudgetTiers } from '../providers/ConfigurationProvider';
import type { BudgetTier } from '../providers/ConfigurationProvider';

export interface ScoredProject {
  project: Project;
  score: number;
  factors: { label: string; value: number; weight: number; weighted: number }[];
}

function priorityScore(v?: number): number {
  if (v === STRATEGIC_PRIORITY.MustHave) return 100;
  if (v === STRATEGIC_PRIORITY.ShouldHave) return 60;
  if (v === STRATEGIC_PRIORITY.NiceToHave) return 30;
  return 0;
}

function complexityScore(v?: number): number {
  if (v === COMPLEXITY.Critical) return 100;
  if (v === COMPLEXITY.High) return 75;
  if (v === COMPLEXITY.Medium) return 50;
  if (v === COMPLEXITY.Low) return 25;
  return 0;
}

function healthScore(v?: number): number {
  if (v === OVERALL_HEALTH.OnTrack) return 100;
  if (v === OVERALL_HEALTH.AtRisk) return 50;
  if (v === OVERALL_HEALTH.OffTrack) return 10;
  return 0;
}

function budgetScore(budget: number | undefined, tiers: BudgetTier[]): number {
  if (!budget || budget <= 0) return 0;
  const sorted = [...tiers].sort((a, b) => b.minAmount - a.minAmount);
  for (const tier of sorted) {
    if (budget >= tier.minAmount) return tier.score;
  }
  return 20;
}

function progressScore(progress?: number): number {
  const p = progress ?? 0;
  const normalized = p > 0 && p <= 1 ? p * 100 : p;
  return Math.round(normalized);
}

export function usePrioritizationScoring(projects: Project[]): ScoredProject[] {
  const weights = usePrioritizationWeights();
  const budgetTiers = usePrioritizationBudgetTiers();

  return useMemo(() => {
    return projects
      .filter((p) => p.statecode === 0)
      .map((project) => {
        const factors = [
          { label: 'Strategic Priority', value: priorityScore(project.pmo_strategicpriority), weight: weights.strategicPriority, weighted: 0 },
          { label: 'Complexity', value: complexityScore(project.pmo_complexity), weight: weights.complexity, weighted: 0 },
          { label: 'Health', value: healthScore(project.proj_overallhealth), weight: weights.health, weighted: 0 },
          { label: 'Budget Scale', value: budgetScore(project.proj_budget, budgetTiers), weight: weights.budget, weighted: 0 },
          { label: 'Progress', value: progressScore(project.msdyn_progress), weight: weights.progress, weighted: 0 },
        ];
        factors.forEach((f) => { f.weighted = Math.round((f.value * f.weight) / 100); });
        const score = factors.reduce((sum, f) => sum + f.weighted, 0);
        return { project, score, factors };
      })
      .sort((a, b) => b.score - a.score);
  }, [projects, weights, budgetTiers]);
}
