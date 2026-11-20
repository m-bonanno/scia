import { API_PREFIX, type DownloadFolder, settingsSchema } from '@scia/contracts';
import { FolderChange } from '@scia/contracts/bridge';
import { z } from 'zod';
import type { EngineAccess } from './engine-access.ts';

// Shows the person the system's folder dialog, opened on the folder in use; undefined when
// they close it without choosing.
export type PickFolder = (current: string) => Promise<string | undefined>;

const REFUSED_STATUS = 400;

// Changing where new downloads go. The page asks for it and names nothing: main shows the
// dialog, and main tells the engine the folder that was chosen.
//
// It answers what became of the folder — changed, kept because the dialog was closed, or
// refused by the engine as one it cannot use — and rejects for everything that is not about
// the folder: an engine that fails or says nothing within `limitMs`. The page tells the two
// apart, and never blames a folder nobody chose. The limit is for the engine's answers, never
// for the person, who takes the time they need in the dialog.
export async function chooseDownloadFolder(
  pick: PickFolder,
  engine: EngineAccess,
  limitMs: number,
): Promise<FolderChange> {
  const authorization = `Bearer ${engine.apiToken}`;
  const read = await engine.fetch(`${engine.origin}${API_PREFIX}/settings`, {
    headers: { authorization },
    signal: AbortSignal.timeout(limitMs),
  });
  if (!read.ok) throw new Error('The engine did not say its settings.');
  // The one setting it needs: a setting it does not know never fails it (engine-settings.ts).
  const { downloadDirectory } = z
    .object({ data: settingsSchema.pick({ downloadDirectory: true }) })
    .parse(await read.json()).data;

  const directory = await pick(downloadDirectory);
  if (directory === undefined) return FolderChange.Kept;

  const changed = await engine.fetch(`${engine.origin}${API_PREFIX}/settings/download-directory`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization },
    body: JSON.stringify({ directory } satisfies DownloadFolder),
    signal: AbortSignal.timeout(limitMs),
  });
  if (changed.status === REFUSED_STATUS) return FolderChange.Refused;
  if (!changed.ok) throw new Error('The engine did not take the folder.');
  return FolderChange.Changed;
}

// One question on screen at a time: an ask that arrives while another is still open — a second
// press before the dialog shows — gets that one's answer, and opens nothing.
export function oneAtATime<T>(ask: () => Promise<T>): () => Promise<T> {
  let open: Promise<T> | undefined;
  return () => {
    open ??= ask().finally(() => {
      open = undefined;
    });
    return open;
  };
}
