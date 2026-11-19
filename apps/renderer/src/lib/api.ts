import {
  API_PREFIX,
  ApiErrorCode,
  type Download,
  downloadSchema,
  errorEnvelopeSchema,
  type Pairing,
  pairingSchema,
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
  pairing: (): Promise<Pairing> => request('/extension/pairing', pairingSchema),
};
