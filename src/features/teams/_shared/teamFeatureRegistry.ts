/**
 * Static registry of team feature packs.
 *
 * Every entry maps a Dataverse team GUID to the feature module that should
 * render for members of that team (and admins acting-as that team). Adding
 * a new team feature pack is a two-line change: import the module here and
 * register it under the team GUID.
 *
 * Lookup keys are stored lowercase to keep equality stable against any
 * Dataverse-emitted casing.
 */
import type { TeamFeatureModule } from './types';
import payerInitiatives from '../payer-initiatives';
import biCoding from '../bi-coding';
import processProject from '../process-project';

const REGISTRY_RAW: TeamFeatureModule[] = [
  payerInitiatives,
  biCoding,
  processProject,
];

const REGISTRY: Record<string, TeamFeatureModule> = Object.fromEntries(
  REGISTRY_RAW.map((m) => [m.teamId.toLowerCase(), m]),
);

export function listAllTeamFeatures(): TeamFeatureModule[] {
  return REGISTRY_RAW;
}

export function getTeamFeatureByTeamId(teamId: string): TeamFeatureModule | undefined {
  return REGISTRY[teamId.toLowerCase()];
}
