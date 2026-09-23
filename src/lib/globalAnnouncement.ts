import { parseTeamAnnouncement, type TeamAnnouncement } from './teamSettings';
import { SETTING_GLOBAL_ANNOUNCEMENT_KEY } from './constants';

export type GlobalAnnouncement = TeamAnnouncement;
export const DEFAULT_GLOBAL_ANNOUNCEMENT: GlobalAnnouncement = {
  title: '', body: '', enabled: false, version: 1, ackMode: 'single',
};
export { SETTING_GLOBAL_ANNOUNCEMENT_KEY };
export const parseGlobalAnnouncement = parseTeamAnnouncement;
