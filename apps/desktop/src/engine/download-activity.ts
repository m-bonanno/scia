import { API_PREFIX, downloadSchema } from '@scia/contracts';
import { DownloadStatus } from '@scia/core';
import { z } from 'zod';
import type { EngineAccess } from './engine-access.ts';

export interface DownloadActivity {
  readonly downloading: number;
  readonly queued: number;
}

// What still needs Scia to be running. A paused or failed download waits for the person, not
// for the app.
export function unfinished(activity: DownloadActivity): number {
  return activity.downloading + activity.queued;
}

// Asked of the engine when main needs it (the window closing, the pointer on the tray icon),
// never on a timer. Rejects when the engine does not answer as expected.
export async function downloadActivity(engine: EngineAccess): Promise<DownloadActivity> {
  const response = await engine.fetch(`${engine.origin}${API_PREFIX}/downloads`, {
    headers: { authorization: `Bearer ${engine.apiToken}` },
  });
  if (!response.ok) throw new Error('The engine did not list its downloads.');
  const downloads = z.object({ data: z.array(downloadSchema) }).parse(await response.json()).data;
  const count = (status: DownloadStatus) =>
    downloads.filter((download) => download.status === status).length;
  return { downloading: count(DownloadStatus.Downloading), queued: count(DownloadStatus.Queued) };
}
