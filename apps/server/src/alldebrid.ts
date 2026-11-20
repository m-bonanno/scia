import type { IntegrationAccount } from '@scia/contracts';
import { ServiceFailure } from '@scia/core';
import { z } from 'zod';

export const ALLDEBRID_API = 'https://api.alldebrid.com';

// The service is far away, and someone is waiting: no answer by then is no answer.
const ANSWER_LIMIT_MS = 10_000;

// The service's refusals that say something of the key (https://docs.alldebrid.com, "All
// errors"). Every other code — maintenance, one Scia does not know — means it cannot be asked
// right now. A map, not an object: a code is a word from outside, and "constructor" is one.
const FAILURE_OF: ReadonlyMap<string, ServiceFailure> = new Map([
  ['AUTH_BAD_APIKEY', ServiceFailure.KeyRefused],
  ['AUTH_BLOCKED', ServiceFailure.KeyBlocked],
  ['AUTH_USER_BANNED', ServiceFailure.AccountBanned],
]);

// The last second a date can name: a number past it is not an instant.
const LAST_SECOND = 8_640_000_000_000;

// The body says whether a request succeeded; the HTTP status that comes with it is not to be
// relied on (the documentation says both that a refused key is a 401 and that it no longer is).
const envelopeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('success'), data: z.unknown() }),
  z.object({ status: z.literal('error'), error: z.object({ code: z.coerce.string() }) }),
]);

const userSchema = z.object({
  user: z.object({
    username: z.string(),
    isPremium: z.boolean(),
    // Seconds since 1970, written as a number or as text; 0 for an account that is not premium.
    premiumUntil: z.coerce.number().nonnegative().max(LAST_SECOND),
  }),
});

export class ServiceError extends Error {
  override readonly name = 'ServiceError';
  readonly failure: ServiceFailure;
  // The service's own code, for the log.
  readonly code: string | null;

  constructor(
    failure: ServiceFailure,
    message: string,
    options: ErrorOptions & { readonly code?: string } = {},
  ) {
    super(message, options);
    this.failure = failure;
    this.code = options.code ?? null;
  }
}

export interface AllDebridOptions {
  // Where the service answers: its own address, or the simulated service's (config.ts).
  readonly api: string;
  readonly userAgent: string;
  readonly answerLimitMs?: number;
}

// AllDebrid's API, as far as Scia uses it. The key travels in the Authorization header of a
// request to the service's own address, and in nothing else: not in an address, not in an
// error, not in a log.
export class AllDebrid {
  readonly #options: AllDebridOptions;

  constructor(options: AllDebridOptions) {
    this.#options = options;
  }

  // Whose account a key is. Rejects with a ServiceError that says why not.
  async account(apiKey: string): Promise<IntegrationAccount> {
    const { user } = await this.#get('/v4/user', apiKey, userSchema);
    return {
      name: user.username,
      premium: user.isPremium,
      premiumUntil: user.premiumUntil > 0 ? new Date(user.premiumUntil * 1000).toISOString() : null,
    };
  }

  async #get<T>(path: string, apiKey: string, schema: z.ZodType<T>): Promise<T> {
    let body: unknown;
    try {
      const response = await fetch(`${this.#options.api}${path}`, {
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: 'application/json',
          'user-agent': this.#options.userAgent,
        },
        // The key is for the service's own address: it does not follow it anywhere else.
        redirect: 'error',
        signal: AbortSignal.timeout(this.#options.answerLimitMs ?? ANSWER_LIMIT_MS),
      });
      body = await response.json();
    } catch (error) {
      throw new ServiceError(ServiceFailure.Unavailable, 'AllDebrid did not answer.', {
        cause: error,
      });
    }
    const envelope = envelopeSchema.safeParse(body);
    if (!envelope.success) {
      throw new ServiceError(ServiceFailure.Unavailable, 'AllDebrid answered something else.');
    }
    if (envelope.data.status === 'error') {
      const { code } = envelope.data.error;
      throw new ServiceError(
        FAILURE_OF.get(code) ?? ServiceFailure.Unavailable,
        `AllDebrid answered ${code}.`,
        { code },
      );
    }
    const data = schema.safeParse(envelope.data.data);
    if (!data.success) {
      throw new ServiceError(ServiceFailure.Unavailable, 'AllDebrid answered something else.');
    }
    return data.data;
  }
}
