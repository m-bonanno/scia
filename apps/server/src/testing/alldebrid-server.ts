import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

// The service's own words for its refusals, as its documentation lists them
// (https://docs.alldebrid.com, "All errors").
const MESSAGES: Readonly<Record<string, string>> = {
  GENERIC: 'An orror occured',
  404: "Endpoint doesn't exist",
  MAINTENANCE: 'Alldebrid is under maintenance, please retry later',
  AUTH_MISSING_APIKEY: 'The auth apikey was not sent',
  AUTH_BAD_APIKEY: 'The auth apikey is invalid',
  AUTH_BLOCKED: 'This apikey is geo-blocked or ip-blocked',
  AUTH_USER_BANNED: 'This account is banned',
  NO_SERVER:
    "Servers are not allowed to use this feature. Visit https://alldebrid.com/vpn if you're using a VPN.",
  LINK_IS_MISSING: 'No link was sent',
  BAD_LINK: 'Sent link in not valid',
  LINK_HOST_NOT_SUPPORTED: 'This host or link is not supported',
  LINK_DOWN: 'This link is not available on the file hoster website',
  LINK_PASS_PROTECTED: 'Link is password protected',
  LINK_HOST_UNAVAILABLE: 'Host under maintenance or not available',
  LINK_TOO_MANY_DOWNLOADS: 'Too many concurrent downloads for this host',
  LINK_HOST_FULL: 'All servers are full for this host, please retry later',
  LINK_HOST_LIMIT_REACHED: 'You have reached the download limit for this host',
  LINK_ERROR: 'Could not unlock this link',
  LINK_TEMPORARY_UNAVAILABLE: 'The link is temporary unavalible on the website',
  LINK_NOT_SUPPORTED: 'The link is not supported for this host',
  DELAYED_INVALID_ID: 'This delayed link id is invalid',
  FREE_TRIAL_LIMIT_REACHED:
    'You have reached the free trial limit (7 days / 25GB downloaded or host uneligible for free trial)',
  MUST_BE_PREMIUM: 'You must be premium to process this link',
  PIN_EXPIRED: 'The pin has expired',
  MAGNET_INVALID_URI: 'Magnet is not valid',
  MAGNET_INVALID_ID: 'This magnet ID does not exists or is invalid',
  MAGNET_TOO_MANY_ACTIVE: 'Already have maximum allowed active magnets (30)',
  MAGNET_TOO_LARGE: 'Magnet files are too large (max 1TB)',
  MAGNET_MUST_BE_PREMIUM: 'You must be premium to use this feature',
  PIN_INVALID: 'This endpoint check parameter is invalid',
};

const ROUTES: readonly string[] = [
  'GET /v4/hosts/domains',
  'GET /v4/user',
  'GET /v4.1/user/hosts',
  'POST /v4/link/unlock',
  'POST /v4/link/delayed',
  'GET /v4.1/pin/get',
  'POST /v4/pin/check',
  'POST /v4/magnet/upload',
  'POST /v4.1/magnet/status',
  'POST /v4/magnet/files',
];

// Where the service has a person confirm a code, as its documentation gives it.
const CODE_PAGE = 'https://alldebrid.com/pin/';

export interface SimulatedAccount {
  readonly username: string;
  // Seconds since 1970, as the service counts; absent or 0 for an account that is not premium.
  readonly premiumUntil?: number;
  // What the service says of the account, when it is not what the date alone would say.
  readonly premium?: boolean;
  // The service knows the key and refuses it all the same.
  readonly refusal?: 'AUTH_BLOCKED' | 'AUTH_USER_BANNED';
  // The hosts, by name, this account unlocks links of; every host of the service if absent.
  readonly hosts?: readonly string[];
}

// A link the service unlocks: what it gives for it, and how.
export interface UnlockableLink {
  // The direct link it gives: a local test host's.
  readonly direct: string;
  readonly filename?: string;
  // The link is not ready at once: the service gives a "delayed" id, and says "still
  // processing" this many times before it gives the link — or says it could not, if `fails`.
  readonly delayedPolls?: number;
  readonly fails?: boolean;
}

// A node of a magnet's files as the service lists them: a folder, with what is in it, or a file,
// with its size and its link — a link of the service's own, unlocked as a hoster's is.
export type SimulatedNode =
  | { readonly n: string; readonly e: readonly SimulatedNode[] }
  | { readonly n: string; readonly s: number; readonly l: string };

// A magnet the service knows, by the hash of its torrent.
export interface SimulatedMagnet {
  readonly name: string;
  readonly size: number;
  readonly files: readonly SimulatedNode[];
  // It is fetched — status 1 — for this many questions about it, then ready (4), or failed (15:
  // no peer) if `fails`.
  readonly fetchingPolls?: number;
  readonly fails?: boolean;
  // Refused when it is sent, with this code of the service's.
  readonly error?: string;
  // What the service calls it when it is sent, before it has read the torrent: "noname".
  readonly nameAtUpload?: string;
  // Its files are answered, this many times, with a code of the service's that Scia does not know.
  readonly unknownFilesAnswers?: number;
}

// What the service makes of a hoster's link it is asked to unlock: a direct link, or one of
// its refusals, by its code.
export type SimulatedLink = UnlockableLink | { readonly error: string };

// What the service does instead of answering as it should.
export type Misbehaviour = (
  | { readonly error: string }
  // An HTTP status and nothing a client can read: too many requests (429), a failing server.
  | { readonly status: number }
  // An answer that is not the service's envelope.
  | { readonly nonsense: true }
  // No answer at all, until the client gives up.
  | { readonly silent: true }
  | { readonly redirectTo: string }
  // The right answer, this long after the question.
  | { readonly slowMs: number }
) & {
  // For this many requests, then it answers as it should again; until told otherwise if absent.
  readonly times?: number;
};

export interface AllDebridServerOptions {
  // The accounts the service knows, by API key.
  readonly accounts: Readonly<Record<string, SimulatedAccount>>;
  // The hosts the service unlocks links of, each with its domains.
  readonly hosts?: Readonly<Record<string, readonly string[]>>;
  // What it also lists to anyone besides its file hosts: sites of videos, shorteners of links.
  readonly streams?: readonly string[];
  readonly redirectors?: readonly string[];
  // The links it knows, by address. A link of one of its hosts that is not here is "down".
  readonly links?: Readonly<Record<string, SimulatedLink>>;
  // The HTTP status that goes with a refused key. The documentation says both that some errors
  // come with a 401 and that 401 is no longer sent: a client has to read the body either way.
  readonly refusalStatus?: number;
  // The documentation's table says `premiumUntil` is a number, its example writes it as text.
  readonly timestampsAsText?: boolean;
  // How long a code to confirm on the site lasts, in seconds: ten minutes, as the documentation
  // says, if absent.
  readonly codeLifetimeSeconds?: number;
  // The magnets it knows, by the hash of their torrent, in lower case. One it does not know is
  // taken and never ready, as a torrent with no peer.
  readonly magnets?: Readonly<Record<string, SimulatedMagnet>>;
  // It answers the magnets of a request last to first: an answer is matched by the magnet it
  // names, not by its place.
  readonly reverseUploads?: boolean;
  // The page it names for a code, when it is not the service's own.
  readonly codePage?: string;
  // The code it gives, when it is not one of its own four letters and digits.
  readonly codePin?: string;
  // A port of its own for a run of the real app; a free one otherwise.
  readonly port?: number;
}

export interface SimulatedRequest {
  readonly method: string;
  // Path and query, as received.
  readonly url: string;
  readonly authorization: string | undefined;
  // The fields of a form that was posted; empty for a GET.
  readonly form: Readonly<Record<string, string>>;
  // Every value of a field sent more than once (`magnets[]`, `id[]`), in order.
  readonly lists: Readonly<Record<string, readonly string[]>>;
  readonly userAgent: string | undefined;
}

export interface AllDebridServer {
  // What stands for https://api.alldebrid.com.
  readonly api: string;
  readonly requests: SimulatedRequest[];
  misbehave(how: Misbehaviour | undefined): void;
  // What the person does on the service's site: the code is confirmed, and gives this key.
  confirmCode(code: string, apiKey: string): void;
  // The account's magnets deleted on the service's site: none is listed any more.
  forgetMagnets(): void;
  // How many times it has answered a confirmed code with its key.
  readonly keysGiven: number;
  close(): Promise<void>;
}

interface GivenCode {
  readonly pin: string;
  readonly expiresAt: number;
  apiKey?: string;
}

// Four letters and digits, as the documentation's example shows a code: the n-th one given.
function pinOf(n: number): string {
  return n.toString(36).toUpperCase().padStart(4, 'A');
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function succeed(response: ServerResponse, data: unknown): void {
  send(response, 200, { status: 'success', data });
}

function refuse(response: ServerResponse, status: number, code: string): void {
  send(response, status, {
    status: 'error',
    error: { code, message: Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : 'Unknown error' },
  });
}

async function formOf(request: IncomingMessage): Promise<URLSearchParams> {
  if (request.method !== 'POST') return new URLSearchParams();
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function listsOf(params: URLSearchParams): Record<string, string[]> {
  const lists: Record<string, string[]> = {};
  for (const [name, value] of params) (lists[name] ??= []).push(value);
  return lists;
}

function hashOf(magnet: string): string | undefined {
  return /xt=urn:btih:([0-9a-z]+)/i.exec(magnet)?.[1]?.toLowerCase();
}

function accountOf(
  request: IncomingMessage,
  options: AllDebridServerOptions,
): SimulatedAccount | string {
  const key = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
  if (key === undefined) return 'AUTH_MISSING_APIKEY';
  const account = options.accounts[key];
  if (account === undefined) return 'AUTH_BAD_APIKEY';
  return account.refusal ?? account;
}

function isPremium(account: SimulatedAccount): boolean {
  return account.premium ?? (account.premiumUntil ?? 0) > 0;
}

function hostOf(link: string, options: AllDebridServerOptions): string | undefined {
  if (!URL.canParse(link)) return undefined;
  const { hostname } = new URL(link);
  return Object.entries(options.hosts ?? {}).find(([, domains]) =>
    domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)),
  )?.[0];
}

// A local host that answers as AllDebrid's documentation says its API does, refusals included.
// Scia is built and proven against this; nobody's real key ever comes near a spec.
export async function startAllDebridServer(
  options: AllDebridServerOptions,
): Promise<AllDebridServer> {
  const requests: SimulatedRequest[] = [];
  let misbehaviour: Misbehaviour | undefined;
  let misbehaved = 0;
  // The links being prepared, by their "delayed" id, with the "still processing" answers left.
  const preparing = new Map<number, { left: number; readonly link: UnlockableLink }>();
  // The codes given, by the check that goes with each.
  const codes = new Map<string, GivenCode>();
  let keysGiven = 0;
  // The magnets sent, by the id the service gave each, with the questions left before it is ready.
  const sent = new Map<number, { readonly hash: string; left: number }>();
  let nextMagnet = 1000;

  function misbehaves(response: ServerResponse): boolean {
    if (misbehaviour === undefined) return false;
    if (misbehaviour.times !== undefined) {
      if (misbehaved >= misbehaviour.times) return false;
      misbehaved += 1;
    }
    if ('silent' in misbehaviour) return true;
    if ('slowMs' in misbehaviour) return false;
    if ('status' in misbehaviour) {
      response.writeHead(misbehaviour.status).end();
    } else if ('nonsense' in misbehaviour) {
      send(response, 200, { hello: 'world' });
    } else if ('redirectTo' in misbehaviour) {
      response.writeHead(302, { location: misbehaviour.redirectTo }).end();
    } else {
      refuse(response, 200, misbehaviour.error);
    }
    return true;
  }

  function user(response: ServerResponse, account: SimulatedAccount): void {
    const premiumUntil = account.premiumUntil ?? 0;
    succeed(response, {
      user: {
        username: account.username,
        email: `${account.username}@example.com`,
        isPremium: isPremium(account),
        isSubscribed: false,
        isTrial: false,
        premiumUntil: options.timestampsAsText === true ? String(premiumUntil) : premiumUntil,
        lang: 'en',
        preferedDomain: 'com',
        fidelityPoints: 0,
        limitedHostersQuotas: {},
        notifications: [],
      },
    });
  }

  function hosts(response: ServerResponse, account: SimulatedAccount): void {
    succeed(response, {
      hosts: Object.fromEntries(
        Object.entries(options.hosts ?? {})
          .filter(([name]) => account.hosts?.includes(name) ?? true)
          .map(([name, domains]) => [
            name,
            { name, type: 'premium', domains, regexps: [`${domains[0] ?? name}/.+`], status: true },
          ]),
      ),
    });
  }

  function unlock(
    response: ServerResponse,
    account: SimulatedAccount,
    link: string | undefined,
  ): void {
    if (link === undefined || link === '') {
      refuse(response, 200, 'LINK_IS_MISSING');
      return;
    }
    const host = hostOf(link, options);
    if (host === undefined) {
      refuse(response, 200, 'LINK_HOST_NOT_SUPPORTED');
      return;
    }
    if (!isPremium(account)) {
      refuse(response, 200, 'MUST_BE_PREMIUM');
      return;
    }
    const known = options.links?.[link];
    if (known === undefined || 'error' in known) {
      refuse(response, 200, known?.error ?? 'LINK_DOWN');
      return;
    }
    const answer = {
      filename: known.filename ?? 'file.bin',
      host,
      hostDomain: options.hosts?.[host]?.[0] ?? host,
      filesize: 0,
      id: 'generation-1',
      paws: false,
      streams: [],
    };
    if (known.delayedPolls === undefined) {
      succeed(response, { ...answer, link: known.direct });
      return;
    }
    const id = preparing.size + 1;
    preparing.set(id, { left: known.delayedPolls, link: known });
    succeed(response, { ...answer, link: '', delayed: id });
  }

  function delayed(response: ServerResponse, id: string | undefined): void {
    const waiting = preparing.get(Number(id));
    if (waiting === undefined) {
      refuse(response, 200, 'DELAYED_INVALID_ID');
    } else if (waiting.left > 0) {
      waiting.left -= 1;
      succeed(response, { status: 1, time_left: (waiting.left + 1) * 5 });
    } else if (waiting.link.fails === true) {
      succeed(response, { status: 3, time_left: 0 });
    } else {
      succeed(response, { status: 2, time_left: 0, link: waiting.link.direct });
    }
  }

  function giveCode(response: ServerResponse): void {
    const lifetime = options.codeLifetimeSeconds ?? 600;
    const pin = options.codePin ?? pinOf(codes.size + 1);
    const check = randomBytes(20).toString('hex');
    codes.set(check, { pin, expiresAt: Date.now() + lifetime * 1000 });
    const page = options.codePage ?? CODE_PAGE;
    succeed(response, {
      pin,
      check,
      expires_in: lifetime,
      user_url: `${page}?pin=${pin}`,
      base_url: page,
    });
  }

  function checkCode(response: ServerResponse, pin: string | undefined, check: string | undefined) {
    const given = check === undefined ? undefined : codes.get(check);
    if (given === undefined || given.pin !== pin) {
      refuse(response, 200, 'PIN_INVALID');
      return;
    }
    const left = Math.ceil((given.expiresAt - Date.now()) / 1000);
    if (left <= 0) {
      refuse(response, 200, 'PIN_EXPIRED');
      return;
    }
    if (given.apiKey !== undefined) keysGiven += 1;
    succeed(
      response,
      given.apiKey === undefined
        ? { activated: false, expires_in: left }
        : { apikey: given.apiKey, activated: true, expires_in: left },
    );
  }

  function uploadMagnets(response: ServerResponse, magnets: readonly string[]): void {
    if (magnets.length === 0) {
      refuse(response, 200, 'MAGNET_NO_URI');
      return;
    }
    const answered = options.reverseUploads === true ? [...magnets].reverse() : magnets;
    succeed(response, {
      magnets: answered.map((magnet) => {
        const hash = hashOf(magnet);
        const known = hash === undefined ? undefined : options.magnets?.[hash];
        const code = hash === undefined ? 'MAGNET_INVALID_URI' : known?.error;
        if (hash === undefined || code !== undefined) {
          return {
            magnet,
            error: {
              code,
              message: Object.hasOwn(MESSAGES, code ?? '') ? MESSAGES[code ?? ''] : '',
            },
          };
        }
        // The same torrent sent again is the same magnet, as the service has it once.
        const id =
          [...sent].find(([, each]) => each.hash === hash)?.[0] ??
          (() => {
            nextMagnet += 1;
            sent.set(nextMagnet, { hash, left: known?.fetchingPolls ?? 0 });
            return nextMagnet;
          })();
        const left = sent.get(id)?.left ?? 0;
        return {
          magnet,
          hash,
          name: known?.nameAtUpload ?? known?.name ?? 'noname',
          size: known?.size ?? 0,
          ready: known !== undefined && left === 0 && known.fails !== true,
          id,
        };
      }),
    });
  }

  function magnetStatuses(response: ServerResponse): void {
    succeed(response, {
      magnets: [...sent].map(([id, each]) => {
        const known = options.magnets?.[each.hash];
        const fetching = known === undefined || each.left > 0;
        if (known !== undefined && each.left > 0) each.left -= 1;
        const statusCode = fetching ? 1 : known.fails === true ? 15 : 4;
        const size = known?.size ?? 0;
        return {
          id,
          filename: known?.name ?? 'noname',
          size,
          status:
            statusCode === 1
              ? 'Downloading'
              : statusCode === 4
                ? 'Ready'
                : 'File not available - no peer',
          statusCode,
          downloaded: statusCode === 4 ? size : Math.floor(size / 2),
          uploaded: 0,
          seeders: 3,
          downloadSpeed: statusCode === 1 ? 1_048_576 : 0,
          uploadSpeed: 0,
          uploadDate: 1_700_000_000,
          completionDate: statusCode === 4 ? 1_700_000_100 : 0,
        };
      }),
    });
  }

  // How many times each magnet's files were answered with a code Scia does not know.
  const filesAnswered = new Map<string, number>();
  function magnetFiles(response: ServerResponse, ids: readonly string[]): void {
    succeed(response, {
      magnets: ids.map((id) => {
        const each = sent.get(Number(id));
        const known = each === undefined ? undefined : options.magnets?.[each.hash];
        if (each === undefined || known === undefined || each.left > 0 || known.fails === true) {
          return { id, error: { code: 'MAGNET_INVALID_ID', message: MESSAGES.MAGNET_INVALID_ID } };
        }
        const unknown = filesAnswered.get(each.hash) ?? 0;
        if (unknown < (known.unknownFilesAnswers ?? 0)) {
          filesAnswered.set(each.hash, unknown + 1);
          return { id, error: { code: 'MAGNET_SOMETHING_NEW', message: 'Something new.' } };
        }
        return { id, files: known.files };
      }),
    });
  }

  const server = createServer((request, response) => {
    void formOf(request).then(async (params) => {
      const form = Object.fromEntries(params);
      const lists = listsOf(params);
      const url = new URL(request.url ?? '/', 'http://simulated');
      requests.push({
        method: request.method ?? '',
        url: request.url ?? '',
        authorization: request.headers.authorization,
        userAgent: request.headers['user-agent'],
        form,
        lists,
      });
      const slow =
        misbehaviour !== undefined && 'slowMs' in misbehaviour ? misbehaviour : undefined;
      const misbehavedBefore = misbehaved;
      if (misbehaves(response)) return;
      // A slow answer is still the right one: it is only late — for as many requests as it says.
      if (slow !== undefined && (slow.times === undefined || misbehaved > misbehavedBefore)) {
        await sleep(slow.slowMs);
      }

      const route = `${request.method ?? ''} ${url.pathname}`;
      if (!ROUTES.includes(route)) {
        refuse(response, 404, '404');
        return;
      }
      if (route === 'GET /v4/hosts/domains') {
        // Public: the documentation says no key is needed.
        succeed(response, {
          hosts: Object.values(options.hosts ?? {}).flat(),
          streams: options.streams ?? [],
          redirectors: options.redirectors ?? [],
        });
        return;
      }
      // Public too: whoever asks for a code has no key yet.
      if (route === 'GET /v4.1/pin/get') {
        giveCode(response);
        return;
      }
      if (route === 'POST /v4/pin/check') {
        checkCode(response, form.pin, form.check);
        return;
      }
      const account = accountOf(request, options);
      if (typeof account === 'string') {
        refuse(response, options.refusalStatus ?? 200, account);
      } else if (route === 'GET /v4/user') {
        user(response, account);
      } else if (route === 'GET /v4.1/user/hosts') {
        hosts(response, account);
      } else if (route === 'POST /v4/magnet/upload') {
        if (!isPremium(account)) refuse(response, 200, 'MAGNET_MUST_BE_PREMIUM');
        else uploadMagnets(response, lists['magnets[]'] ?? []);
      } else if (route === 'POST /v4.1/magnet/status') {
        magnetStatuses(response);
      } else if (route === 'POST /v4/magnet/files') {
        magnetFiles(response, lists['id[]'] ?? []);
      } else if (route === 'POST /v4/link/unlock') {
        unlock(response, account, form.link);
      } else {
        delayed(response, form.id);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    api: `http://127.0.0.1:${String(port)}`,
    requests,
    misbehave: (how) => {
      misbehaviour = how;
      misbehaved = 0;
    },
    get keysGiven() {
      return keysGiven;
    },
    forgetMagnets: () => {
      sent.clear();
    },
    confirmCode: (code, apiKey) => {
      const given = [...codes.values()].find((each) => each.pin === code);
      if (given === undefined) throw new Error(`No code ${code} was given.`);
      given.apiKey = apiKey;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
