import { useMemo, useSyncExternalStore } from 'react';
import { useAppSettings } from './useAppSettings';
import {
  parseGlobalAnnouncement,
  SETTING_GLOBAL_ANNOUNCEMENT_KEY,
  type GlobalAnnouncement,
} from '../lib/globalAnnouncement';
import {
  isGlobalAcked,
  subscribeToGlobalAnnouncementAcks,
  getGlobalAcksSnapshot,
} from '../lib/globalAnnouncementAcks';
import { useMyAnnouncementAcks } from './useAnnouncementAcks';

export type { GlobalAnnouncement };

export function useGlobalAnnouncement(): GlobalAnnouncement {
  const { data: settings = [] } = useAppSettings();
  return useMemo(() => {
    const row = settings.find((s) => s.pmo_key === SETTING_GLOBAL_ANNOUNCEMENT_KEY);
    return parseGlobalAnnouncement(row?.pmo_value);
  }, [settings]);
}

export interface ActiveGlobalAnnouncement {
  title: string;
  body: string;
  /** Optional Tenor GIF URL appended to the body in the popup display. */
  bodyGifUrl?: string;
  version: number;
  /** 'single' -> persistent per-user ack; 'everyLoad' -> session-only ack. */
  ackMode: 'single' | 'everyLoad';
}

export function useActiveGlobalAnnouncement(): ActiveGlobalAnnouncement | null {
  const { data: settings = [] } = useAppSettings();
  const acksSnapshot = useSyncExternalStore(subscribeToGlobalAnnouncementAcks, getGlobalAcksSnapshot);
  const persistentAcks = useMyAnnouncementAcks();

  return useMemo(() => {
    const row = settings.find((s) => s.pmo_key === SETTING_GLOBAL_ANNOUNCEMENT_KEY);
    const ann = parseGlobalAnnouncement(row?.pmo_value);
    if (!ann.enabled) return null;
    if (!ann.title.trim() && !ann.body.trim() && !ann.bodyGifUrl) return null;
    // Single-Time mode: check the persisted per-user acks (survives reload).
    // Every-Load mode: check the in-memory session ack (reappears each load).
    if (ann.ackMode === 'single') {
      // persistentAcks is undefined while the ack query is loading — suppress the
      // popup until we KNOW whether the user has already acked it. This prevents
      // the flash-of-popup on reload that occurred because the empty-set default
      // returned by the unresolved query looked like "no acks yet" (= show popup).
      if (persistentAcks === undefined) return null;
      if (persistentAcks.has(`global:${ann.version}`)) return null;
    } else if (isGlobalAcked(ann.version)) {
      return null;
    }
    return {
      title: ann.title,
      body: ann.body,
      bodyGifUrl: ann.bodyGifUrl,
      version: ann.version,
      ackMode: ann.ackMode,
    };
  // acksSnapshot + persistentAcks are reactive triggers so acks re-evaluate live
  }, [settings, acksSnapshot, persistentAcks]); // eslint-disable-line react-hooks/exhaustive-deps
}
