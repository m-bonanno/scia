import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

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
};

const ROUTES: readonly string[] = [
  'GET /v4/user',
  'GET /v4.1/user/hosts',
  'POST /v4/link/unlock',
  'POST /v4/link/delayed',
];

export interface SimulatedAccount {
  readonly username: string;
  // Seconds since 1970, as the service counts; absent or 0 for an account that is not premium.
  readonly premiumUntil?: number;
  // The service knows the key and refuses it all the same.
  readonly refusal?: 'AUTH_BLOCKED' | 'AUTH_USER_BANNED';
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
) & {
  // For this many requests, then it answers as it should again; until told otherwise if absent.
  readonly times?: number;
};

export interface AllDebridServerOptions {
  // The accounts the service knows, by API key.
  readonly accounts: Readonly<Record<string, SimulatedAccount>>;
  // The hosts the service unlocks links of, each with its domains.
  readonly hosts?: Readonly<Record<string, readonly string[]>>;
  // The links it knows, by address. A link of one of its hosts that is not here is "down".
  readonly links?: Readonly<Record<string, SimulatedLink>>;
  // The HTTP status that goes with a refused key. The documentation says both that some errors
  // come with a 401 and that 401 is no longer sent: a client has to read the body either way.
  readonly refusalStatus?: number;
  // The documentation's table says `premiumUntil` is a number, its example writes it as text.
  readonly timestampsAsText?: boolean;
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
  readonly userAgent: string | undefined;
}

export interface AllDebridServer {
  // What stands for https://api.alldebrid.com.
  readonly api: string;
  readonly requests: SimulatedRequest[];
  misbehave(how: Misbehaviour | undefined): void;
  close(): Promise<void>;
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

async function formOf(request: IncomingMessage): Promise<Record<string, string>> {
  if (request.method !== 'POST') return {};
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
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
  return (account.premiumUntil ?? 0) > 0;
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

  function misbehaves(response: ServerResponse): boolean {
    if (misbehaviour === undefined) return false;
    if (misbehaviour.times !== undefined) {
      if (misbehaved >= misbehaviour.times) return false;
      misbehaved += 1;
    }
    if ('silent' in misbehaviour) return true;
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

  function hosts(response: ServerResponse): void {
    succeed(response, {
      hosts: Object.fromEntries(
        Object.entries(options.hosts ?? {}).map(([name, domains]) => [
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

  const server = createServer((request, response) => {
    void formOf(request).then((form) => {
      const url = new URL(request.url ?? '/', 'http://simulated');
      requests.push({
        method: request.method ?? '',
        url: request.url ?? '',
        authorization: request.headers.authorization,
        userAgent: request.headers['user-agent'],
        form,
      });
      if (misbehaves(response)) return;

      const route = `${request.method ?? ''} ${url.pathname}`;
      if (!ROUTES.includes(route)) {
        refuse(response, 404, '404');
        return;
      }
      const account = accountOf(request, options);
      if (typeof account === 'string') {
        refuse(response, options.refusalStatus ?? 200, account);
      } else if (route === 'GET /v4/user') {
        user(response, account);
      } else if (route === 'GET /v4.1/user/hosts') {
        hosts(response);
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
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
