/**
 * SharePoint connector FILE ACTIONS — hand-authored operation definitions.
 *
 * `pac code add-data-source` binds a SharePoint library as a TABLE and only
 * generates GET entity helpers — it does NOT emit the connector's file actions
 * (Create file, Get file content). But the Power Apps SDK's executeAsync CAN
 * call any operation whose {path, parameters} exist in the data source's `apis`
 * map (it builds the URL + binary body from that definition; see
 * connectorDataOperationExecutor `_buildStandardOperationUrl` /
 * `_buildOperationBodyParam`). So we declare the two file actions here and merge
 * them into the generated dataSourcesInfo.
 *
 * Isolated in this module (NOT edited into the generated dataSourcesInfo.ts) so
 * re-running `pac code add-data-source` never clobbers them. dataverseClient
 * merges these via applySharePointFileOps() when building ALL_SOURCES.
 *
 * Contracts from the SharePoint connector reference:
 *   CreateFile           POST /{connectionId}/datasets/{dataset}/files
 *                        query: folderPath, name ; body: binary file content
 *   GetFileContentByPath GET  /{connectionId}/datasets/{dataset}/GetFileContentByPath
 *                        query: path
 */

/** Extra file-action op-defs to merge into the appdocuments data source's `apis`. */
export const SHAREPOINT_FILE_APIS: Record<string, unknown> = {
  CreateFile: {
    path: '/{connectionId}/datasets/{dataset}/files',
    method: 'POST',
    parameters: [
      { name: 'connectionId', in: 'path', required: true, type: 'string' },
      { name: 'dataset', in: 'path', required: true, type: 'string' },
      { name: 'folderPath', in: 'query', required: true, type: 'string' },
      { name: 'name', in: 'query', required: true, type: 'string' },
      // Body is a base64 string with format:binary. The SDK sends it as-is
      // (no JSON.stringify) and the connector decodes it — base64 is ASCII so
      // it survives the runtime's UTF-8 Blob wrapping intact (a raw/latin1
      // string would be corrupted for any byte >= 128, e.g. PNGs).
      { name: 'body', in: 'body', required: true, type: 'string', format: 'binary' },
    ],
    responseInfo: { '200': { type: 'object' } },
  },
  GetFileMetadataByPath: {
    path: '/{connectionId}/datasets/{dataset}/GetFileByPath',
    method: 'GET',
    parameters: [
      { name: 'connectionId', in: 'path', required: true, type: 'string' },
      { name: 'dataset', in: 'path', required: true, type: 'string' },
      { name: 'path', in: 'query', required: true, type: 'string' },
    ],
    responseInfo: { '200': { type: 'object' } },
  },
  GetFileContentByPath: {
    path: '/{connectionId}/datasets/{dataset}/GetFileContentByPath',
    method: 'GET',
    parameters: [
      { name: 'connectionId', in: 'path', required: true, type: 'string' },
      { name: 'dataset', in: 'path', required: true, type: 'string' },
      { name: 'path', in: 'query', required: true, type: 'string' },
    ],
    responseInfo: { '200': { type: 'string', format: 'binary' } },
  },
  DeleteFileByPath: {
    // Delete uses the file identifier form; DeleteFile takes an id. For path-
    // based cleanup we send an HTTP request instead (see deleteSharePointFile).
    path: '/{connectionId}/datasets/{dataset}/files/{id}',
    method: 'DELETE',
    parameters: [
      { name: 'connectionId', in: 'path', required: true, type: 'string' },
      { name: 'dataset', in: 'path', required: true, type: 'string' },
      { name: 'id', in: 'path', required: true, type: 'string' },
    ],
    responseInfo: { '200': { type: 'object' } },
  },
};

/**
 * Merge the file-action op-defs into a dataSourcesInfo object's appdocuments
 * entry (mutates a shallow clone's apis). Call once when assembling ALL_SOURCES.
 */
export function applySharePointFileOps<T extends object>(
  sources: T,
  dataSourceName = 'appdocuments',
): T {
  const ds = (sources as Record<string, { apis?: Record<string, unknown> }>)[dataSourceName];
  if (ds) ds.apis = { ...(ds.apis ?? {}), ...SHAREPOINT_FILE_APIS };
  return sources;
}
