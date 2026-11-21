import type { IntegrationId } from '@scia/contracts';
import {
  CodeFailure,
  type MagnetFailure,
  type ServiceFailure,
  type UnlockFailure,
} from '@scia/core';

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

// A code to confirm on the service's site that no longer gives a key: its time ran out, or the
// service no longer knows it (#136). Never a download's failure.
export class CodeExpiredError extends Error {
  override readonly name = 'CodeExpiredError';
  readonly service: IntegrationId;
  readonly failure = CodeFailure.Expired;

  constructor(service: IntegrationId, message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.service = service;
  }
}

// A magnet the service will not fetch, or no longer has (#137). Never a download's failure: a
// magnet is not a download.
export class MagnetError extends Error {
  override readonly name = 'MagnetError';
  readonly service: IntegrationId;
  readonly failure: MagnetFailure;

  constructor(service: IntegrationId, failure: MagnetFailure, message: string) {
    super(message);
    this.service = service;
    this.failure = failure;
  }
}
