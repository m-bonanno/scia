import type { IntegrationId } from '@scia/contracts';
import type { ServiceFailure, UnlockFailure } from '@scia/core';

// A service refused, or did not answer. What it carries is safe to log: never a key, never a
// link.
export class ServiceError extends Error {
  override readonly name = 'ServiceError';
  readonly service: IntegrationId;
  readonly failure: ServiceFailure | UnlockFailure;
  // The service's own code, for the log.
  readonly code: string | null;

  constructor(
    service: IntegrationId,
    failure: ServiceFailure | UnlockFailure,
    message: string,
    options: ErrorOptions & { readonly code?: string } = {},
  ) {
    super(message, options);
    this.service = service;
    this.failure = failure;
    this.code = options.code ?? null;
  }
}
