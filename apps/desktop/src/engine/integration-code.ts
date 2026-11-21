import { API_PREFIX, integrationCodeSchema, isIntegrationId, isServiceSite } from '@scia/contracts';
import { z } from 'zod';
import type { EngineAccess } from './engine-access.ts';

// The page where the person confirms the code the engine gave for a service (#136). The page
// names the service and nothing else; main asks the engine, and opens only a page of the
// service's own site — never an address from the page, nor one the engine was brought.
export async function codePageAddress(
  id: unknown,
  engine: EngineAccess,
  limitMs: number,
): Promise<string> {
  if (!isIntegrationId(id)) throw new Error('Not a service.');
  const response = await engine.fetch(`${engine.origin}${API_PREFIX}/integrations/${id}/code`, {
    headers: { authorization: `Bearer ${engine.apiToken}` },
    signal: AbortSignal.timeout(limitMs),
  });
  if (!response.ok) throw new Error('No code is waiting for this service.');
  const { url } = z.object({ data: integrationCodeSchema }).parse(await response.json()).data;
  if (!isServiceSite(id, url)) throw new Error("The code's page is not on the service's site.");
  return url;
}
