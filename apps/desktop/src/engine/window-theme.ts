import { settingsSchema } from '@scia/contracts';
import type { Theme } from '@scia/contracts/theme';
import type { EngineAccess } from './engine-access.ts';
import { settingsOfEngine } from './engine-settings.ts';

// The theme the person chose, as the engine keeps it: what the window's own colours follow. The
// page never names it to main — it says only that it changed. Rejects when the engine fails,
// answers something else, or says nothing within `limitMs`.
export async function themeOfEngine(engine: EngineAccess, limitMs: number): Promise<Theme> {
  const settings = await settingsOfEngine(engine, limitMs);
  return settingsSchema.pick({ theme: true }).parse(settings).theme;
}
