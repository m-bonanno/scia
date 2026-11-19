import { join } from 'node:path';
import { API_PREFIX, downloadSchema } from '@scia/contracts';
import { DownloadStatus } from '@scia/core';
import { z } from 'zod';

// An id is the engine's own (a UUID): anything else never reaches a request's path.
const ID = /^[\w-]{1,64}$/;

export interface EngineAccess {
  readonly origin: string;
  readonly apiToken: string;
  readonly fetch: (url: string, init: { headers: Record<string, string> }) => Promise<Response>;
}

// Where a finished download is on disk, asked of the engine by id. The page names a download;
// it never gives main a path to open.
export async function completedDownloadPath(id: unknown, engine: EngineAccess): Promise<string> {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('Not a download id.');
  const response = await engine.fetch(`${engine.origin}${API_PREFIX}/downloads/${id}`, {
    headers: { authorization: `Bearer ${engine.apiToken}` },
  });
  if (!response.ok) throw new Error('The engine does not know this download.');
  const download = z.object({ data: downloadSchema }).parse(await response.json()).data;
  if (download.status !== DownloadStatus.Completed) {
    throw new Error('Only a finished download has a file to show.');
  }
  return join(download.directory, download.fileName);
}
