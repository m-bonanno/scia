import { API_PREFIX, type DownloadFolder, settingsSchema } from '@scia/contracts';
import { z } from 'zod';
import type { EngineAccess } from './engine-access.ts';

// Shows the person the system's folder dialog, opened on the folder in use; undefined when
// they close it without choosing.
export type PickFolder = (current: string) => Promise<string | undefined>;

// Changing where new downloads go. The page asks for it and names nothing: main shows the
// dialog, and main tells the engine the folder that was chosen. Answers whether it changed.
// Rejects when the engine refuses the folder, or says nothing within `limitMs` — the limit is
// for the engine's answers, never for the person, who takes the time they need in the dialog.
export async function chooseDownloadFolder(
  pick: PickFolder,
  engine: EngineAccess,
  limitMs: number,
): Promise<boolean> {
  const authorization = `Bearer ${engine.apiToken}`;
  const read = await engine.fetch(`${engine.origin}${API_PREFIX}/settings`, {
    headers: { authorization },
    signal: AbortSignal.timeout(limitMs),
  });
  if (!read.ok) throw new Error('The engine did not say its settings.');
  const { downloadDirectory } = z.object({ data: settingsSchema }).parse(await read.json()).data;

  const directory = await pick(downloadDirectory);
  if (directory === undefined) return false;

  const changed = await engine.fetch(`${engine.origin}${API_PREFIX}/settings/download-directory`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization },
    body: JSON.stringify({ directory } satisfies DownloadFolder),
    signal: AbortSignal.timeout(limitMs),
  });
  if (!changed.ok) throw new Error('The engine refused the folder.');
  return true;
}
