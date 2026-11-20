import { API_PREFIX, settingsSchema } from '@scia/contracts';
import { z } from 'zod';
import type { EngineAccess } from './engine-access.ts';

// The settings as the engine keeps them, unread: each caller reads the one it needs, so that a
// setting it does not know never fails it. Rejects when the engine fails, or says nothing within
// `limitMs`.
export async function settingsOfEngine(engine: EngineAccess, limitMs: number): Promise<unknown> {
  const response = await engine.fetch(`${engine.origin}${API_PREFIX}/settings`, {
    headers: { authorization: `Bearer ${engine.apiToken}` },
    signal: AbortSignal.timeout(limitMs),
  });
  if (!response.ok) throw new Error('The engine did not say its settings.');
  return z.object({ data: z.unknown() }).parse(await response.json()).data;
}

// Whether the person follows the betas (docs/adr/0007-automatic-updates.md).
export async function betasOfEngine(engine: EngineAccess, limitMs: number): Promise<boolean> {
  const settings = await settingsOfEngine(engine, limitMs);
  return settingsSchema.pick({ betaUpdates: true }).parse(settings).betaUpdates;
}
