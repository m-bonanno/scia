import {
  type AccountMagnet,
  accountMagnetSchema,
  API_PREFIX,
  ApiErrorCode,
  type Bundle,
  bundleSchema,
  type Download,
  downloadSchema,
  errorEnvelopeSchema,
  type Integration,
  type IntegrationCode,
  integrationCodeSchema,
  type IntegrationId,
  integrationSchema,
  type Magnet,
  magnetSchema,
  type Settings,
  type SettingsPatch,
  settingsSchema,
} from '@scia/contracts';
import { z } from 'zod';
import { bridge } from './bridge.ts';

export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function authorization(): Record<string, string> {
  const token = bridge()?.apiToken;
  return token === undefined || token === '' ? {} : { authorization: `Bearer ${token}` };
}

async function request<T>(
  path: string,
  schema: z.ZodType<T> | null,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...authorization() },
  });
  if (!response.ok) {
    const envelope = errorEnvelopeSchema.safeParse(await response.json().catch(() => null));
    throw envelope.success
      ? new ApiError(response.status, envelope.data.error.code, envelope.data.error.message)
      : new ApiError(response.status, ApiErrorCode.InternalError, 'No error envelope.');
  }
  if (schema === null) return undefined as T;
  // What crosses the wire is checked on this side too.
  return z.object({ data: schema }).parse(await response.json()).data;
}

export const api = {
  addDownloads: (urls: readonly string[]): Promise<Download[]> =>
    request('/downloads', z.array(downloadSchema), {
      method: 'POST',
      body: JSON.stringify({ urls }),
    }),
  // Magnets for the connected service to fetch (#137): the page sends them, and never reads one back.
  addMagnets: (magnets: readonly string[]): Promise<Magnet[]> =>
    request('/magnets', z.array(magnetSchema), {
      method: 'POST',
      body: JSON.stringify({ magnets }),
    }),
  // The magnets of the connected service's account (#138).
  accountMagnets: (): Promise<AccountMagnet[]> =>
    request('/magnets/account', z.array(accountMagnetSchema)),
  addAccountMagnet: (id: number): Promise<Magnet> =>
    request(`/magnets/account/${String(id)}`, magnetSchema, { method: 'POST' }),
  retryMagnet: (id: string): Promise<Magnet> =>
    request(`/magnets/${encodeURIComponent(id)}/retry`, magnetSchema, { method: 'POST' }),
  removeMagnet: (id: string): Promise<void> =>
    request(`/magnets/${encodeURIComponent(id)}`, null, { method: 'DELETE' }),
  // A link that opens into several files (#181): the files chosen, by their place in its list.
  startBundle: (id: string, files: readonly number[]): Promise<Download[]> =>
    request(`/bundles/${encodeURIComponent(id)}/start`, z.array(downloadSchema), {
      method: 'POST',
      body: JSON.stringify({ files }),
    }),
  retryBundle: (id: string): Promise<Bundle> =>
    request(`/bundles/${encodeURIComponent(id)}/retry`, bundleSchema, { method: 'POST' }),
  removeBundle: (id: string): Promise<void> =>
    request(`/bundles/${encodeURIComponent(id)}`, null, { method: 'DELETE' }),
  start: (id: string): Promise<Download> =>
    request(`/downloads/${encodeURIComponent(id)}/start`, downloadSchema, { method: 'POST' }),
  startReady: (): Promise<Download[]> =>
    request('/downloads/start-ready', z.array(downloadSchema), { method: 'POST' }),
  // Every completed download off the list, the files kept (#215).
  clearCompleted: (): Promise<void> =>
    request('/downloads/clear-completed', null, { method: 'POST' }),
  pause: (id: string): Promise<Download> =>
    request(`/downloads/${encodeURIComponent(id)}/pause`, downloadSchema, { method: 'POST' }),
  resume: (id: string): Promise<Download> =>
    request(`/downloads/${encodeURIComponent(id)}/resume`, downloadSchema, { method: 'POST' }),
  remove: (id: string, deleteFile: boolean): Promise<void> =>
    request(`/downloads/${encodeURIComponent(id)}?deleteFile=${String(deleteFile)}`, null, {
      method: 'DELETE',
    }),
  settings: (): Promise<Settings> => request('/settings', settingsSchema),
  updateSettings: (patch: SettingsPatch): Promise<Settings> =>
    request('/settings', settingsSchema, { method: 'PATCH', body: JSON.stringify(patch) }),
  integrations: (): Promise<Integration[]> => request('/integrations', z.array(integrationSchema)),
  // The key goes to the engine and is never read back: no answer carries it.
  connectIntegration: (id: IntegrationId, apiKey: string): Promise<Integration> =>
    request(`/integrations/${encodeURIComponent(id)}`, integrationSchema, {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    }),
  disconnectIntegration: (id: IntegrationId): Promise<void> =>
    request(`/integrations/${encodeURIComponent(id)}`, null, { method: 'DELETE' }),
  // A code to confirm on the service's site: the engine waits for it, and connects the key the
  // service gives — which never reaches the page.
  startIntegrationCode: (id: IntegrationId): Promise<IntegrationCode> =>
    request(`/integrations/${encodeURIComponent(id)}/code`, integrationCodeSchema, {
      method: 'POST',
    }),
  integrationCode: (id: IntegrationId): Promise<IntegrationCode> =>
    request(`/integrations/${encodeURIComponent(id)}/code`, integrationCodeSchema),
  // With a code named, the engine forgets that one only.
  cancelIntegrationCode: (id: IntegrationId, code?: string): Promise<void> =>
    request(
      `/integrations/${encodeURIComponent(id)}/code${code === undefined ? '' : `?code=${encodeURIComponent(code)}`}`,
      null,
      { method: 'DELETE' },
    ),
};
