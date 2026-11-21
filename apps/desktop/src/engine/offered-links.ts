import { API_PREFIX, downloadSchema, magnetSchema } from '@scia/contracts';
import { z } from 'zod';
import type { EngineAccess } from './engine-access.ts';

// Hands the links read on the clipboard to the engine, which adds those it knows, ready
// (docs/adr/0012). Answers how many it added. Rejects when the engine refuses, answers something
// else, or says nothing within `limitMs`.
export async function offerToEngine(
  links: readonly string[],
  engine: EngineAccess,
  limitMs: number,
): Promise<number> {
  const response = await engine.fetch(`${engine.origin}${API_PREFIX}/downloads/offered`, {
    method: 'POST',
    headers: { authorization: `Bearer ${engine.apiToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ urls: links }),
    signal: AbortSignal.timeout(limitMs),
  });
  if (!response.ok) throw new Error('The engine did not take the links.');
  return z.object({ data: z.array(downloadSchema) }).parse(await response.json()).data.length;
}

// Hands the magnets read on the clipboard to the engine, which sends them to the connected
// service at once, or leaves them out with none (#139; docs/adr/0017). Answers how many it sent.
export async function offerMagnetsToEngine(
  magnets: readonly string[],
  engine: EngineAccess,
  limitMs: number,
): Promise<number> {
  const response = await engine.fetch(`${engine.origin}${API_PREFIX}/magnets/offered`, {
    method: 'POST',
    headers: { authorization: `Bearer ${engine.apiToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ magnets }),
    signal: AbortSignal.timeout(limitMs),
  });
  // A refusal has no list of magnets: it rejects here as an answer it cannot read.
  return z.object({ data: z.array(magnetSchema) }).parse(await response.json()).data.length;
}

export interface OfferedNotice {
  readonly title: string;
  readonly body: string;
}

// What the system shows when links were added while the person is not looking at the list (the
// owner, #128). The fact first; the rows are in the list, each with its Start.
export function offeredNotice(added: number): OfferedNotice {
  const links = added === 1 ? 'link' : 'links';
  return { title: `Added ${String(added)} ${links}, ready to start`, body: '' };
}

// What the system shows when copied magnets were sent while the person is not looking at the list
// (#139): they do not wait for a Start, the service fetches them.
export function sentNotice(sent: number): OfferedNotice {
  const magnets = sent === 1 ? 'magnet' : 'magnets';
  return { title: `Sent ${String(sent)} ${magnets} to AllDebrid`, body: '' };
}
