import { setTimeout as sleep } from 'node:timers/promises';
import { type IntegrationAccount, IntegrationId } from '@scia/contracts';
import { ServiceFailure, UnlockFailure } from '@scia/core';
import { z } from 'zod';
import type { UnlockedLink } from './link-resolver.ts';
import { ServiceError } from './service-error.ts';

export const ALLDEBRID_API = 'https://api.alldebrid.com';

// The service is far away, and someone is waiting: no answer by then is no answer.
const ANSWER_LIMIT_MS = 10_000;
// A link that is being prepared is asked about this often: the documentation says "every 5
// seconds or more".
const DELAYED_POLL_MS = 5000;
// How many times in a row a link's request is made while the service cannot be asked.
const ATTEMPTS = 3;

function defaultRetryDelayMs(attempt: number): number {
  return 1000 * 2 ** (attempt - 1);
}

// What each of the service's refusals means to Scia (https://docs.alldebrid.com, "All
// errors"). Every other code — maintenance, one Scia does not know — means the service cannot
// be asked right now: nothing is said of a key or of a link that the service did not say. A
// map, not an object: a code is a word from outside, and "constructor" is one.
const FAILURE_OF: ReadonlyMap<string, ServiceFailure | UnlockFailure> = new Map<
  string,
  ServiceFailure | UnlockFailure
>([
  ['AUTH_BAD_APIKEY', ServiceFailure.KeyRefused],
  ['AUTH_BLOCKED', ServiceFailure.KeyBlocked],
  ['AUTH_USER_BANNED', ServiceFailure.AccountBanned],
  ['NO_SERVER', ServiceFailure.NetworkRefused],
  ['MUST_BE_PREMIUM', UnlockFailure.NotPremium],
  ['FREE_TRIAL_LIMIT_REACHED', UnlockFailure.NotPremium],
  ['LINK_DOWN', UnlockFailure.LinkDown],
  ['LINK_PASS_PROTECTED', UnlockFailure.LinkPassword],
  ['LINK_HOST_UNAVAILABLE', UnlockFailure.HostUnavailable],
  ['LINK_HOST_FULL', UnlockFailure.HostUnavailable],
  ['LINK_TEMPORARY_UNAVAILABLE', UnlockFailure.HostUnavailable],
  ['LINK_HOST_LIMIT_REACHED', UnlockFailure.HostLimit],
  ['LINK_TOO_MANY_DOWNLOADS', UnlockFailure.HostLimit],
  ['LINK_IS_MISSING', UnlockFailure.LinkRefused],
  ['BAD_LINK', UnlockFailure.LinkRefused],
  ['LINK_HOST_NOT_SUPPORTED', UnlockFailure.LinkRefused],
  ['LINK_NOT_SUPPORTED', UnlockFailure.LinkRefused],
  ['LINK_ERROR', UnlockFailure.LinkRefused],
  ['DELAYED_INVALID_ID', UnlockFailure.LinkRefused],
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

const hostsSchema = z.object({
  hosts: z.record(z.string(), z.object({ domains: z.array(z.string()) })),
});

const unlockSchema = z.object({
  // Empty, or absent, while the link is being prepared.
  link: z.string().nullish(),
  filename: z.string().nullish(),
  // The id to ask about a link that needs time; absent or 0 for one that is ready.
  delayed: z.coerce.number().nullish(),
});

const delayedSchema = z.object({
  // 1: still processing. 2: the link is there. Anything else: it could not be made (3).
  status: z.coerce.number(),
  link: z.string().nullish(),
});
const DelayedStatus = { Processing: 1, Ready: 2 } as const;

export interface AllDebridOptions {
  // Where the service answers: its own address, or the simulated service's (config.ts).
  readonly api: string;
  readonly userAgent: string;
  readonly answerLimitMs?: number;
  readonly delayedPollMs?: number;
  readonly retryDelayMs?: (attempt: number) => number;
}

function refused(failure: ServiceFailure | UnlockFailure, message: string, code?: string) {
  return new ServiceError(
    IntegrationId.AllDebrid,
    failure,
    message,
    code === undefined ? {} : { code },
  );
}

function isHttpAddress(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^https?:$/.test(URL.parse(value)?.protocol ?? '');
}

// AllDebrid's API, as far as Scia uses it. The key travels in the Authorization header of a
// request to the service's own address, and in nothing else: not in an address, not in an
// error, not in a log. Every method rejects with a ServiceError that says why not, or with the
// reason of `signal` when whoever asked has stopped.
export class AllDebrid {
  readonly #options: AllDebridOptions;

  constructor(options: AllDebridOptions) {
    this.#options = options;
  }

  // Whose account a key is. Asked once, and of nobody who can stop the question: someone is
  // looking at Settings.
  async account(apiKey: string): Promise<IntegrationAccount> {
    const { user } = await this.#ask('/v4/user', apiKey, userSchema, undefined, undefined);
    return {
      name: user.username,
      premium: user.isPremium,
      premiumUntil: user.premiumUntil > 0 ? new Date(user.premiumUntil * 1000).toISOString() : null,
    };
  }

  // The domains of the hosts whose links the service unlocks for this account, in lower case.
  async domains(apiKey: string, signal?: AbortSignal): Promise<string[]> {
    const { hosts } = await this.#insist(
      () => this.#ask('/v4.1/user/hosts', apiKey, hostsSchema, undefined, signal),
      signal,
    );
    return Object.values(hosts).flatMap((host) =>
      host.domains.map((domain) => domain.toLowerCase()),
    );
  }

  // The direct link for a hoster's. A link the service needs time to prepare is waited for,
  // for as long as the service says it is preparing it and nobody stops the wait.
  async unlock(apiKey: string, link: string, signal?: AbortSignal): Promise<UnlockedLink> {
    const answer = await this.#insist(
      () => this.#ask('/v4/link/unlock', apiKey, unlockSchema, { link }, signal),
      signal,
    );
    const delayedId = answer.delayed ?? 0;
    const url = delayedId > 0 ? await this.#whenPrepared(apiKey, delayedId, signal) : answer.link;
    if (!isHttpAddress(url)) {
      throw refused(UnlockFailure.LinkRefused, 'AllDebrid gave no link.');
    }
    return { url, fileName: answer.filename ?? undefined };
  }

  async #whenPrepared(
    apiKey: string,
    id: number,
    signal: AbortSignal | undefined,
  ): Promise<string | null | undefined> {
    for (;;) {
      await sleep(this.#options.delayedPollMs ?? DELAYED_POLL_MS, undefined, { signal });
      const { status, link } = await this.#insist(
        () => this.#ask('/v4/link/delayed', apiKey, delayedSchema, { id: String(id) }, signal),
        signal,
      );
      if (status === DelayedStatus.Ready) return link;
      // It says it failed, or something that is neither "ready" nor "still preparing".
      if (status !== DelayedStatus.Processing) {
        throw refused(UnlockFailure.LinkRefused, 'AllDebrid could not prepare the link.');
      }
    }
  }

  // A service that cannot be asked right now is asked again, a few times: what it refuses, it
  // refuses at once.
  async #insist<T>(ask: () => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await ask();
      } catch (error) {
        const heals = error instanceof ServiceError && error.failure === ServiceFailure.Unavailable;
        if (!heals || attempt >= ATTEMPTS) throw error;
        const delayMs = (this.#options.retryDelayMs ?? defaultRetryDelayMs)(attempt);
        await sleep(delayMs, undefined, { signal });
      }
    }
  }

  // One request: a GET, or a POST of `form` when there is one.
  async #ask<T>(
    path: string,
    apiKey: string,
    schema: z.ZodType<T>,
    form: Readonly<Record<string, string>> | undefined,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    const limit = AbortSignal.timeout(this.#options.answerLimitMs ?? ANSWER_LIMIT_MS);
    let body: unknown;
    try {
      const response = await fetch(`${this.#options.api}${path}`, {
        ...(form === undefined ? {} : { method: 'POST', body: new URLSearchParams(form) }),
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: 'application/json',
          'user-agent': this.#options.userAgent,
        },
        // The key is for the service's own address: it does not follow it anywhere else.
        redirect: 'error',
        signal: signal === undefined ? limit : AbortSignal.any([signal, limit]),
      });
      body = await response.json();
    } catch (error) {
      signal?.throwIfAborted();
      throw new ServiceError(
        IntegrationId.AllDebrid,
        ServiceFailure.Unavailable,
        'AllDebrid did not answer.',
        { cause: error },
      );
    }
    const envelope = envelopeSchema.safeParse(body);
    if (!envelope.success) {
      throw refused(ServiceFailure.Unavailable, 'AllDebrid answered something else.');
    }
    if (envelope.data.status === 'error') {
      const { code } = envelope.data.error;
      throw refused(
        FAILURE_OF.get(code) ?? ServiceFailure.Unavailable,
        `AllDebrid answered ${code}.`,
        code,
      );
    }
    const data = schema.safeParse(envelope.data.data);
    if (!data.success) {
      throw refused(ServiceFailure.Unavailable, 'AllDebrid answered something else.');
    }
    return data.data;
  }
}
