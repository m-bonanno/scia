import { setTimeout as sleep } from 'node:timers/promises';
import {
  connectIntegrationSchema,
  type IntegrationAccount,
  integrationCodeSchema,
  IntegrationId,
  isServiceSite,
} from '@scia/contracts';
import {
  hashOfMagnet,
  MagnetFailure,
  PREPARE_LIMIT_SECONDS,
  ServiceFailure,
  UnlockFailure,
} from '@scia/core';
import { z } from 'zod';
import type { UnlockedLink } from './link-resolver.ts';
import { CodeExpiredError, ServiceError } from './service-error.ts';

export const ALLDEBRID_API = 'https://api.alldebrid.com';

// The service is far away, and someone is waiting: no answer by then is no answer.
const ANSWER_LIMIT_MS = 10_000;
// The public list is asked with no service connected, and a direct link waits on it: one
// question, given up on soon, never asked again in the same breath (#49).
export const PUBLIC_ANSWER_LIMIT_MS = 3000;
// A code is waited for this long at most, whatever the service says: its documentation gives ten
// minutes, and a lifetime from outside becomes a date (#136).
export const CODE_LIMIT_SECONDS = 600;
// A link that is being prepared is asked about this often: the documentation says "every 5
// seconds or more".
const DELAYED_POLL_MS = 5000;
// A link the service is still preparing after this long is given up on, and the place it held
// in the queue given back. Retry starts again.
export const DELAYED_LIMIT_MS = PREPARE_LIMIT_SECONDS * 1000;
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

// Said of every magnet of a request at once: an answer to magnets alone.
const MAGNETS_REFUSED: ReadonlyMap<string, ServiceFailure | UnlockFailure> = new Map<
  string,
  ServiceFailure | UnlockFailure
>([
  ['MAGNET_MUST_BE_PREMIUM', UnlockFailure.NotPremium],
  ['MAGNET_NO_SERVER', ServiceFailure.NetworkRefused],
]);

// What each of the service's refusals of one magnet means (https://docs.alldebrid.com, "All
// errors"). Every other code is a service that cannot be asked right now, as for a link.
const MAGNET_FAILURE_OF: ReadonlyMap<string, MagnetFailure> = new Map<string, MagnetFailure>([
  ['MAGNET_NO_URI', MagnetFailure.Invalid],
  ['MAGNET_INVALID_URI', MagnetFailure.Invalid],
  ['MAGNET_INVALID_FILE', MagnetFailure.Invalid],
  ['MAGNET_TOO_MANY_ACTIVE', MagnetFailure.Limit],
  ['MAGNET_TOO_MANY', MagnetFailure.Limit],
  ['MAGNET_TOO_LARGE', MagnetFailure.TooLarge],
  ['MAGNET_MAGNET_TOO_BIG', MagnetFailure.TooLarge],
  ['MAGNET_MUST_BE_PREMIUM', MagnetFailure.NotPremium],
  ['MAGNET_NO_SERVER', MagnetFailure.NetworkRefused],
  ['MAGNET_INVALID_ID', MagnetFailure.Failed],
  // The ends the documentation lists for a magnet the service took and could not finish.
  ['MAGNET_CANT_BOOTSTRAP', MagnetFailure.Failed],
  ['MAGNET_TOOK_TOO_LONG', MagnetFailure.Failed],
  ['MAGNET_LINKS_REMOVED', MagnetFailure.Failed],
  ['MAGNET_PROCESSING_FAILED', MagnetFailure.Failed],
  ['MAGNET_UPLOAD_FAILED', MagnetFailure.Failed],
  ['MAGNET_FILE_UPLOAD_FAILED', MagnetFailure.Failed],
  ['MAGNET_INTERNAL_ERROR', MagnetFailure.Failed],
]);

// A torrent's folders are not this deep, nor its files this many: an answer that is, is not one.
const MAGNET_TREE_DEPTH = 32;
const MAGNET_FILES_AT_MOST = 100_000;

// A code whose time ran out, and a check the service no longer knows — which is what an expired
// code's check becomes: either way a new code is asked for. An answer to a code alone.
const CODE_EXPIRED: ReadonlySet<string> = new Set(['PIN_EXPIRED', 'PIN_INVALID']);

// The last second of the year 9999, in seconds since 1970: past it a date is written
// `+010000-…`, which no ISO date-time the page takes is (integrations.ts of the contracts).
const LAST_SECOND = 253_402_300_799;

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

// What the service lists to anyone: file hosts, and sites of videos and shorteners of links,
// which are no file hosts and are not read.
const publicHostsSchema = z.object({ hosts: z.array(z.string()) });

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

const refusalSchema = z.object({ code: z.coerce.string() });

const uploadSchema = z.object({
  magnets: z.array(
    z.union([
      z.object({ magnet: z.string(), error: refusalSchema }),
      z.object({
        magnet: z.string(),
        hash: z
          .string()
          .transform((hash) => hash.toLowerCase())
          .optional(),
        id: z.number().int().positive(),
        name: z.string(),
        size: z.coerce.number().int().nonnegative(),
        ready: z.boolean(),
      }),
    ]),
  ),
});

const magnetStateSchema = z.object({
  id: z.number().int().positive(),
  filename: z.string(),
  size: z.coerce.number().int().nonnegative(),
  // 0 to 3: queued, fetching, made into an archive, sent on. 4: ready. Past it: failed.
  statusCode: z.coerce.number().int().nonnegative(),
  downloaded: z.coerce.number().int().nonnegative().nullish(),
  downloadSpeed: z.coerce.number().int().nonnegative().nullish(),
  // Seconds since 1970; 0 or absent when the service does not say.
  uploadDate: z.coerce.number().int().nonnegative().nullish(),
});
const magnetIdSchema = z.object({ id: z.number().int().positive() });
// A list, or — as some of its answers write it — an object by id. Each entry is read on its own:
// a magnet of the account Scia cannot read is passed over, and stops nothing of the others.
const magnetStatesSchema = z.object({
  magnets: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]),
});
const MAGNET_READY = 4;

const magnetFilesSchema = z.object({
  magnets: z.array(
    z.object({
      id: z.coerce.string(),
      files: z.unknown().optional(),
      error: refusalSchema.optional(),
    }),
  ),
});
const fileNodeSchema = z.object({
  n: z.string(),
  s: z.coerce.number().int().nonnegative(),
  l: z.string(),
});
const folderNodeSchema = z.object({ n: z.string(), e: z.array(z.unknown()) });

const codeSchema = z.object({
  pin: z.string(),
  check: z.string().min(1),
  expires_in: z.number().int().nonnegative(),
  user_url: z.string(),
});

const confirmationSchema = z.object({
  activated: z.boolean(),
  apikey: z.string().nullish(),
});

// What the service says of one magnet it was sent: taken, with its id, or refused.
export type SentMagnet =
  | {
      readonly magnet: string;
      readonly taken: {
        readonly id: number;
        readonly name: string;
        readonly size: number;
        readonly ready: boolean;
      };
    }
  | { readonly magnet: string; readonly failure: MagnetFailure };

// Where a magnet of the account is.
export type MagnetState =
  | {
      readonly id: number;
      readonly name: string;
      readonly size: number;
      readonly downloaded: number;
      readonly bytesPerSecond: number;
      // When it was added to the account, in seconds since 1970, when the service says.
      readonly addedAt: number | null;
      readonly stage: 'fetching' | 'ready' | 'failed';
    }
  // Listed by its id, the rest of it written in a way Scia cannot read.
  | { readonly id: number; readonly stage: 'unreadable' };

// A file of a ready magnet: the folders the magnet puts it in, its name, its size, and the link
// of the service's that is unlocked as a hoster's is.
export interface MagnetFile {
  readonly folders: readonly string[];
  readonly name: string;
  readonly size: number;
  readonly link: string;
}

// The service's tree of a magnet's files, as a list: false for a node that is neither a file nor a
// folder, a link that is not an http address, a tree deeper or larger than any torrent.
function filesOfTree(nodes: unknown, folders: readonly string[], into: MagnetFile[]): boolean {
  if (!Array.isArray(nodes) || folders.length > MAGNET_TREE_DEPTH) return false;
  for (const node of nodes) {
    const file = fileNodeSchema.safeParse(node);
    if (file.success) {
      if (!isHttpAddress(file.data.l) || into.length >= MAGNET_FILES_AT_MOST) return false;
      into.push({ folders, name: file.data.n, size: file.data.s, link: file.data.l });
      continue;
    }
    const folder = folderNodeSchema.safeParse(node);
    if (!folder.success || !filesOfTree(folder.data.e, [...folders, folder.data.n], into)) {
      return false;
    }
  }
  return true;
}

// A code to confirm on the service's site (https://docs.alldebrid.com, "Pin auth"). `check` is
// what the service gives the key for once the code is confirmed: it never leaves the engine.
export interface ServiceCode {
  readonly code: string;
  readonly check: string;
  readonly url: string;
  readonly expiresInSeconds: number;
}

export interface AllDebridOptions {
  // Where the service answers: its own address, or the simulated service's (config.ts).
  readonly api: string;
  readonly userAgent: string;
  readonly answerLimitMs?: number;
  readonly publicAnswerLimitMs?: number;
  readonly delayedPollMs?: number;
  readonly delayedLimitMs?: number;
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

// A form, a field sent once for every value of a list (`magnets[]`, `id[]`).
function formBody(form: Readonly<Record<string, string | readonly string[]>>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(form)) {
    for (const each of typeof value === 'string' ? [value] : value) body.append(name, each);
  }
  return body;
}

function isHttpAddress(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^https?:$/.test(URL.parse(value)?.protocol ?? '');
}

// A wait that, when whoever asked stops, rejects with what they said: a timer's own rejection
// says only that it was aborted.
async function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  try {
    await sleep(ms, undefined, { signal });
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
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
      // A day only for an account that is premium, and only when the service gives one.
      premiumUntil:
        user.isPremium && user.premiumUntil > 0
          ? new Date(user.premiumUntil * 1000).toISOString()
          : null,
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

  // The domains of the file hosts the service supports, as it lists them to anyone: no key is
  // sent, and nothing of any link (#49).
  async publicDomains(signal?: AbortSignal): Promise<string[]> {
    const { hosts } = await this.#ask(
      '/v4/hosts/domains',
      undefined,
      publicHostsSchema,
      undefined,
      signal,
      this.#options.publicAnswerLimitMs ?? PUBLIC_ANSWER_LIMIT_MS,
    );
    return hosts.map((domain) => domain.toLowerCase());
  }

  // A code for the person to confirm on the service's site, asked with no key. The page it names
  // is on the service's own site, or the answer is not taken.
  async code(signal?: AbortSignal): Promise<ServiceCode> {
    const given = await this.#ask('/v4.1/pin/get', undefined, codeSchema, undefined, signal);
    const shown = integrationCodeSchema.shape.code.safeParse(given.pin).success;
    if (!shown || !isServiceSite(IntegrationId.AllDebrid, given.user_url)) {
      throw refused(ServiceFailure.Unavailable, 'AllDebrid answered something else.');
    }
    return {
      code: given.pin,
      check: given.check,
      url: given.user_url,
      expiresInSeconds: Math.min(given.expires_in, CODE_LIMIT_SECONDS),
    };
  }

  // The key a confirmed code gives, or nothing while the person has not confirmed it. Asked with
  // no key, and once: whoever waits asks again.
  async confirmedKey(
    code: string,
    check: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const answer = await this.#ask(
      '/v4/pin/check',
      undefined,
      confirmationSchema,
      { pin: code, check },
      signal,
    ).catch((error: unknown) => {
      if (error instanceof ServiceError && CODE_EXPIRED.has(error.code ?? '')) {
        throw new CodeExpiredError(
          IntegrationId.AllDebrid,
          `AllDebrid answered ${error.code ?? ''}.`,
        );
      }
      throw error;
    });
    if (!answer.activated) return undefined;
    // A key travels in a header: what could not is no key.
    const key = connectIntegrationSchema.safeParse({ apiKey: answer.apikey });
    if (!key.success) {
      throw refused(ServiceFailure.Unavailable, 'AllDebrid answered something else.');
    }
    return key.data.apiKey;
  }

  // Magnets for the account to fetch (https://docs.alldebrid.com, "Upload magnet"), in one
  // request: the service answers each on its own. Sent once — a magnet sent again is the same
  // one to the service, but a request that may have been carried out is not asked twice.
  async uploadMagnets(
    apiKey: string,
    magnets: readonly string[],
    signal?: AbortSignal,
  ): Promise<SentMagnet[]> {
    const answer = await this.#ask(
      '/v4/magnet/upload',
      apiKey,
      uploadSchema,
      { 'magnets[]': magnets },
      signal,
    ).catch((error: unknown) => {
      const failure =
        error instanceof ServiceError ? MAGNETS_REFUSED.get(error.code ?? '') : undefined;
      if (failure === undefined) throw error;
      throw refused(
        failure,
        `AllDebrid answered ${error instanceof ServiceError ? (error.code ?? '') : ''}.`,
      );
    });
    return magnets.map((magnet, index) => {
      // By the magnet it names; else by its torrent, as the service may write the magnet its way;
      // else by its place.
      const said =
        answer.magnets.find((each) => each.magnet === magnet) ??
        answer.magnets.find((each) => 'hash' in each && each.hash === hashOfMagnet(magnet)) ??
        answer.magnets[index];
      if (said === undefined) return { magnet, failure: MagnetFailure.Unavailable };
      if ('error' in said) {
        return {
          magnet,
          failure: MAGNET_FAILURE_OF.get(said.error.code) ?? MagnetFailure.Unavailable,
        };
      }
      return {
        magnet,
        taken: { id: said.id, name: said.name, size: said.size, ready: said.ready },
      };
    });
  }

  // Where every magnet of the account is (https://docs.alldebrid.com, "Get Status"), in one
  // question, whatever the number Scia waits for.
  async magnetStates(apiKey: string, signal?: AbortSignal): Promise<MagnetState[]> {
    const { magnets } = await this.#insist(
      () => this.#ask('/v4.1/magnet/status', apiKey, magnetStatesSchema, {}, signal),
      signal,
    );
    return Object.values(magnets).flatMap((entry): MagnetState[] => {
      const read = magnetStateSchema.safeParse(entry);
      if (!read.success) {
        // Said of the magnet it names, when it names one: else a stranger's, passed over.
        const named = magnetIdSchema.safeParse(entry);
        return named.success ? [{ id: named.data.id, stage: 'unreadable' }] : [];
      }
      const each = read.data;
      return [
        {
          id: each.id,
          name: each.filename,
          size: each.size,
          downloaded: each.downloaded ?? 0,
          bytesPerSecond: each.downloadSpeed ?? 0,
          addedAt:
            each.uploadDate === undefined || each.uploadDate === null || each.uploadDate === 0
              ? null
              : each.uploadDate,
          stage:
            each.statusCode < MAGNET_READY
              ? 'fetching'
              : each.statusCode === MAGNET_READY
                ? 'ready'
                : 'failed',
        },
      ];
    });
  }

  // The files of ready magnets, with their folders (https://docs.alldebrid.com, "Get Files and
  // Links"): the tree the service keeps of each torrent, all asked in one request. Each answered
  // magnet is in the map: its files, or why there are none. One the service does not answer about
  // is not in it. Nothing here heals by asking again: each answer is final for its magnet.
  async magnetFiles(
    apiKey: string,
    ids: readonly number[],
    signal?: AbortSignal,
  ): Promise<Map<number, MagnetFile[] | MagnetFailure>> {
    const { magnets } = await this.#insist(
      () =>
        this.#ask(
          '/v4/magnet/files',
          apiKey,
          magnetFilesSchema,
          { 'id[]': ids.map(String) },
          signal,
        ),
      signal,
    );
    const answered = new Map<number, MagnetFile[] | MagnetFailure>();
    for (const id of ids) {
      const mine = magnets.find((each) => each.id === String(id));
      if (mine === undefined) continue;
      if (mine.error !== undefined) {
        // A code Scia does not know is one it cannot say more of: as for a magnet sent.
        answered.set(id, MAGNET_FAILURE_OF.get(mine.error.code) ?? MagnetFailure.Unavailable);
        continue;
      }
      const files: MagnetFile[] = [];
      if (!filesOfTree(mine.files, [], files)) answered.set(id, MagnetFailure.Unreadable);
      // A ready magnet with no file is one that gave nothing.
      else answered.set(id, files.length === 0 ? MagnetFailure.Failed : files);
    }
    return answered;
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
    const giveUpAt = performance.now() + (this.#options.delayedLimitMs ?? DELAYED_LIMIT_MS);
    for (;;) {
      if (performance.now() >= giveUpAt) {
        throw refused(UnlockFailure.NotReady, 'AllDebrid was still preparing the link.');
      }
      await wait(this.#options.delayedPollMs ?? DELAYED_POLL_MS, signal);
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
        await wait(delayMs, signal);
      }
    }
  }

  // One request: a GET, or a POST of `form` when there is one.
  async #ask<T>(
    path: string,
    apiKey: string | undefined,
    schema: z.ZodType<T>,
    form: Readonly<Record<string, string | readonly string[]>> | undefined,
    signal: AbortSignal | undefined,
    limitMs = this.#options.answerLimitMs ?? ANSWER_LIMIT_MS,
  ): Promise<T> {
    const limit = AbortSignal.timeout(limitMs);
    let body: unknown;
    try {
      const response = await fetch(`${this.#options.api}${path}`, {
        ...(form === undefined ? {} : { method: 'POST', body: formBody(form) }),
        headers: {
          ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }),
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
