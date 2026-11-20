import { ServiceFailure } from '@scia/core';
import { z } from 'zod';

// The services Scia can be connected to. What each is called lives in the renderer.
export const IntegrationId = { AllDebrid: 'alldebrid' } as const;
export type IntegrationId = (typeof IntegrationId)[keyof typeof IntegrationId];

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
});
export type Integration = z.infer<typeof integrationSchema>;

// A key as a service gives it: visible characters and no space — it travels in a header.
// What surrounds it when it is pasted is not part of it.
export const connectIntegrationSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .regex(/^[\x21-\x7e]{1,256}$/),
});
export type ConnectIntegration = z.infer<typeof connectIntegrationSchema>;
