/**
 * SharePoint document-backend configuration.
 *
 * The app stores documents in the Nexus-PMO "AppDocuments" library on
 * https://aetnao365.sharepoint.com/sites/Nexus-PMO (same library in DEV and
 * PROD). Files are stored flat in the library and LINKED to their owning record
 * via metadata columns (RecordType + ProjectID/ProgramID/TaskID/IntakeID/
 * DocumentCategory), not by folder path — the SharePoint connector's list
 * filters those columns and does not recurse into subfolders. See sharePointFiles.ts.
 */
import { getContext } from './powerAppsContext';
import { isDemoActive } from './demoMode';

export const SP_SITE = 'https://aetnao365.sharepoint.com/sites/Nexus-PMO';
export const SP_LIBRARY = 'AppDocuments';
/** Generated connector data-source name (see app/src/generated). */
export const SP_DATASOURCE = 'appdocuments';

/**
 * Current user's email (userPrincipalName) from the Power Apps host context,
 * lower-cased. Used to gate document deletion (creator-or-admin). Returns
 * undefined when unavailable (dev server).
 */
let _userEmail: string | null | undefined;
export async function getCurrentUserEmail(): Promise<string | undefined> {
  if (_userEmail !== undefined) return _userEmail ?? undefined;
  // Demo mode: no host bridge. getContext() never settles on a static host, so a
  // bare try/catch does NOT protect us (it hangs, it never throws). Return a
  // stable fake identity so creator-or-admin delete gating still resolves.
  if (isDemoActive()) {
    _userEmail = 'demo.user@demo.example';
    return _userEmail;
  }
  try {
    const ctx = await getContext();
    const upn = (ctx.user as { userPrincipalName?: string } | undefined)?.userPrincipalName;
    _userEmail = upn ? upn.toLowerCase() : null;
  } catch {
    _userEmail = null;
  }
  return _userEmail ?? undefined;
}
