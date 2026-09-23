/**
 * Team bulletin posts — backed by the Dataverse `annotation` table, same
 * pattern as project / task notes (api/projectNotes.api.ts).
 *
 * Each post is an annotation row whose `objectid` points at the team:
 *   objecttypecode = 'team'
 *   _objectid_value = {teamId}
 *
 * Subject carries a routing tag so we can distinguish bulletin posts from
 * any unrelated team-scoped notes (`bulletin:v1` for top-level,
 * `bulletin:v1:reply:{parentId}` for replies).
 *
 * Notetext carries a JSON envelope (see lib/bulletinEnvelope.ts) with the
 * post body, mention metadata, optional GIF, and reactions map.
 *
 * SETUP REQUIREMENT: the standard `team` entity does NOT have Notes enabled
 * by default. An admin must enable Notes on `team` (Maker portal → Tables
 * → Team → Properties → Enable attachments) once per env before posts can
 * be created. The page surfaces a friendly error if create returns 400.
 */
import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import {
  encode,
  decode,
  topLevelSubject,
  replySubject,
  isBulletinSubject,
  parseParentAnnotationId,
  type BulletinPayload,
} from '../lib/bulletinEnvelope';

const SET = ENTITY_SETS.annotation;

export interface BulletinRow {
  annotationid: string;
  subject?: string;
  notetext?: string;
  createdon?: string;
  modifiedon?: string;
  '_objectid_value'?: string;
  objecttypecode?: string;
  '_createdby_value'?: string;
  '_createdby_value@OData.Community.Display.V1.FormattedValue'?: string;
}

/** Decoded shape used by the React layer. */
export interface BulletinPost {
  annotationId: string;
  /** Empty string for top-level posts, the parent annotation id for replies. */
  parentId: string;
  authorId: string;
  authorName: string;
  createdOn: string;
  modifiedOn: string;
  payload: BulletinPayload;
}

const SELECT_FIELDS = [
  'annotationid',
  'subject',
  'notetext',
  'createdon',
  'modifiedon',
  '_objectid_value',
  'objecttypecode',
  '_createdby_value',
] as const;

function decodeRow(row: BulletinRow): BulletinPost {
  return {
    annotationId: row.annotationid,
    parentId: parseParentAnnotationId(row.subject) ?? '',
    authorId: (row['_createdby_value'] ?? '').toLowerCase(),
    authorName: row['_createdby_value@OData.Community.Display.V1.FormattedValue'] ?? '—',
    createdOn: row.createdon ?? '',
    modifiedOn: row.modifiedon ?? row.createdon ?? '',
    payload: decode(row.notetext),
  };
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * Fetch every bulletin row attached to the team, including replies. The
 * caller (BulletinFeed) groups by parent in memory. We return decoded
 * shapes so the UI never has to know about the JSON envelope.
 */
export async function listTeamBulletin(teamId: string): Promise<BulletinPost[]> {
  const rows = await dv.list<BulletinRow>(SET, {
    $select: [...SELECT_FIELDS],
    // objecttypecode 'team' for the standard system Team entity. The
    // subject filter narrows to bulletin rows (excludes any unrelated
    // team-scoped notes someone might add through the model-driven app).
    $filter:
      `_objectid_value eq ${teamId} and objecttypecode eq 'team' and ` +
      `startswith(subject,'bulletin:v1') and isdocument eq false`,
    $orderby: 'createdon desc',
    $top: 500,
  });
  return rows.filter((r) => isBulletinSubject(r.subject)).map(decodeRow);
}

// ── Writes ──────────────────────────────────────────────────────────────────

export interface BulletinCreateInput {
  teamId: string;
  payload: BulletinPayload;
  /** Optional — when set, this becomes a reply nested under the parent. */
  parentAnnotationId?: string;
}

export async function createBulletinPost(input: BulletinCreateInput): Promise<BulletinPost> {
  const subject = input.parentAnnotationId
    ? replySubject(input.parentAnnotationId)
    : topLevelSubject();
  const created = await dv.create<BulletinRow>(SET, {
    subject,
    notetext: encode(input.payload),
    'objectid_team@odata.bind': `/teams(${input.teamId})`,
  });
  // The create response from the OData client doesn't always come back
  // with the formatted-value annotation for createdby, so the UI does an
  // optimistic insert with the current user's name and reconciles when
  // the list query refetches.
  return decodeRow(created);
}

/** Replace the JSON envelope on an existing post. Used for reactions. */
export async function updateBulletinPayload(
  annotationId: string,
  payload: BulletinPayload,
): Promise<void> {
  await dv.update(SET, annotationId, { notetext: encode(payload) });
}

export async function deleteBulletinPost(annotationId: string): Promise<void> {
  await dv.remove(SET, annotationId);
}
