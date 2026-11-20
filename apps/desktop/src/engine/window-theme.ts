import { API_PREFIX, settingsSchema } from '@scia/contracts';
import type { Theme } from '@scia/contracts/theme';
import { z } from 'zod';
import type { EngineAccess } from './engine-access.ts';

// The theme the person chose, as the engine keeps it: what the window's own colours follow. The
// page never names it to main — it says only that it changed. Rejects when the engine fails,
// answers something else, or says nothing within `limitMs`.
export async function themeOfEngine(engine: EngineAccess, limitMs: number): Promise<Theme> {
  const response = await engine.fetch(`${engine.origin}${API_PREFIX}/settings`, {
    headers: { authorization: `Bearer ${engine.apiToken}` },
    signal: AbortSignal.timeout(limitMs),
  });
  if (!response.ok) throw new Error('The engine did not say its settings.');
  return z.object({ data: settingsSchema }).parse(await response.json()).data.theme;
}
