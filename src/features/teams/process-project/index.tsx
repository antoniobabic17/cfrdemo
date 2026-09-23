/**
 * Process & Project feature pack — registry entry.
 *
 * See app/src/features/teams/_shared/types.ts for the contract. Consumed by
 * teamFeatureRegistry.ts; nothing else imports it directly. Renders for:
 *   - Members of the Process & Project team, OR
 *   - Admins who have flipped the "Act as Process & Project" pill
 *
 * Currently a stub — registers the team so its "Act as" pill appears in the
 * admin sidebar. Routes / sidebar items / slots can be populated later as
 * the team asks for their own surfaces (analogous to how bi-coding started
 * with an empty pack and grew a Coding tab slot).
 */
import { PROCESS_PROJECT_TEAM_ID, PROCESS_PROJECT_TEAM_NAMES, PROCESS_PROJECT_DISPLAY } from './constants';
import type { TeamFeatureModule } from '../_shared/types';

const processProject: TeamFeatureModule = {
  teamId: PROCESS_PROJECT_TEAM_ID,
  teamNames: PROCESS_PROJECT_TEAM_NAMES,
  displayName: PROCESS_PROJECT_DISPLAY,
  routes: [],
  sidebarItems: [],
  slots: {},
};

export default processProject;
