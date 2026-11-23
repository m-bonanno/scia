import { CodeFailure, ServiceFailure } from '@scia/core';
import { z } from 'zod';

// The services Scia can be connected to.
export const IntegrationId = { AllDebrid: 'alldebrid' } as const;
export type IntegrationId = (typeof IntegrationId)[keyof typeof IntegrationId];

// What each is called: by the page, and by the notification main shows once one connects (#146).
export const SERVICE_NAME: Readonly<Record<IntegrationId, string>> = { alldebrid: 'AllDebrid' };

export function isIntegrationId(value: unknown): value is IntegrationId {
  return Object.values(IntegrationId).some((id) => id === value);
}

export const integrationAccountSchema = z.object({
  name: z.string(),
  premium: z.boolean(),
  // An instant, as ISO 8601. Null for an account that is not premium, and when the service
  // does not say until when.
  premiumUntil: z.iso.datetime().nullable(),
});
export type IntegrationAccount = z.infer<typeof integrationAccountSchema>;

export const integrationSchema = z.object({
  id: z.enum(IntegrationId),
  // Scia holds a key for the service. The key itself never crosses the API back.
  connected: z.boolean(),
  // What the service last said of the account: null when not connected, and when it has not
  // said since Scia started.
  account: integrationAccountSchema.nullable(),
  // Why it did not say, the last time it was asked.
  failure: z.enum(ServiceFailure).nullable(),
  // A key was kept for the service and could not be read back at this start: the service is not
  // connected, and the person connects it again (docs/adr/0023).
  keyNotRead: z.boolean(),
});
export type Integration = z.infer<typeof integrationSchema>;

// How long main waits, once it wrote a key, for what opens it to be on disk before it says the key
// is kept (docs/adr/0023). The engine waits that long for main's answer to a write, beside its
// bound for any answer.
export const KEY_SEAL_LIMIT_MS = 20_000;

// A key as a service gives it: visible characters and no space — it travels in a header.
// What surrounds it when it is pasted is not part of it.
export const connectIntegrationSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .regex(/^[\x21-\x7e]{1,256}$/),
});
export type ConnectIntegration = z.infer<typeof connectIntegrationSchema>;

// The site each service has a person confirm a code on: a page Scia opens is on it, or on one of
// its names, over https — never an address an answer brought as it stands. Read from the start
// of the address: nobody before the host (`user@`), no port after it, and the host ends there.
const SERVICE_PAGE: Readonly<Record<IntegrationId, RegExp>> = {
  alldebrid: /^https:\/\/(?:[a-z0-9-]+\.)*alldebrid\.com(?:[/?#]|$)/i,
};

export function isServiceSite(id: IntegrationId, url: string): boolean {
  return SERVICE_PAGE[id].test(url);
}

export const IntegrationCodeStatus = {
  // The person has not confirmed it yet.
  Waiting: 'waiting',
  // Confirmed: the service gave a key, and Scia keeps it.
  Connected: 'connected',
  Failed: 'failed',
} as const;
export type IntegrationCodeStatus =
  (typeof IntegrationCodeStatus)[keyof typeof IntegrationCodeStatus];

// Why a code connected nothing: the service's refusals of the key it gave, the code's own, and a
// system that would not keep the key (ApiErrorCode.KeyNotKept).
export const IntegrationCodeFailure = {
  ...ServiceFailure,
  ...CodeFailure,
  KeyNotKept: 'KEY_NOT_KEPT',
} as const;
export type IntegrationCodeFailure =
  (typeof IntegrationCodeFailure)[keyof typeof IntegrationCodeFailure];

// Why the key a confirmed code gave connected nothing: the service's refusals of it, and a system
// that would not keep it. A code that only expired is not one of them.
export const CodeConnectFailure = {
  ...ServiceFailure,
  KeyNotKept: IntegrationCodeFailure.KeyNotKept,
} as const;
export type CodeConnectFailure = (typeof CodeConnectFailure)[keyof typeof CodeConnectFailure];

// The last code confirmed on the service's site whose key connected nothing, and when: main says it
// with a notification while nobody looks at the window (the owner, #146). The moment tells one
// failure from the next.
export const codeConnectFailedSchema = z.object({
  service: z.enum(IntegrationId),
  failure: z.enum(CodeConnectFailure),
  at: z.iso.datetime(),
});
export type CodeConnectFailed = z.infer<typeof codeConnectFailedSchema>;

// A code to confirm on the service's site, and what became of it. What the service needs to give
// the key for it stays in the engine: only what the person reads and the page they open cross.
export const integrationCodeSchema = z.object({
  code: z.string().regex(/^[\x21-\x7e]{1,32}$/),
  // Where it is confirmed. Main opens it only on the service's site (isServiceSite).
  url: z.url({ protocol: /^https$/ }),
  expiresAt: z.iso.datetime(),
  status: z.enum(IntegrationCodeStatus),
  failure: z.enum(IntegrationCodeFailure).nullable(),
});
export type IntegrationCode = z.infer<typeof integrationCodeSchema>;
