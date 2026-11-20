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
};

export interface SimulatedAccount {
  readonly username: string;
  // Seconds since 1970, as the service counts; absent or 0 for an account that is not premium.
  readonly premiumUntil?: number;
  // The service knows the key and refuses it all the same.
  readonly refusal?: 'AUTH_BLOCKED' | 'AUTH_USER_BANNED';
}

// What the service does instead of answering as it should, until told otherwise.
export type Misbehaviour =
  // Every request gets this error, whatever it asked.
  | { readonly error: string }
  // An HTTP status and nothing a client can read: too many requests (429), a failing server.
  | { readonly status: number }
  // An answer that is not the service's envelope.
  | { readonly nonsense: true }
  // No answer at all, until the client gives up.
  | { readonly silent: true }
  | { readonly redirectTo: string };

export interface AllDebridServerOptions {
  // The accounts the service knows, by API key.
  readonly accounts: Readonly<Record<string, SimulatedAccount>>;
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

function refuse(response: ServerResponse, status: number, code: string): void {
  send(response, status, {
    status: 'error',
    error: { code, message: MESSAGES[code] ?? 'Unknown error' },
  });
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

// A local host that answers as AllDebrid's documentation says its API does, refusals included.
// Scia is built and proven against this; nobody's real key ever comes near a spec.
export async function startAllDebridServer(
  options: AllDebridServerOptions,
): Promise<AllDebridServer> {
  const requests: SimulatedRequest[] = [];
  let misbehaviour: Misbehaviour | undefined;

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://simulated');
    requests.push({
      method: request.method ?? '',
      url: request.url ?? '',
      authorization: request.headers.authorization,
    });
    if (misbehaviour !== undefined) {
      if ('silent' in misbehaviour) return;
      if ('status' in misbehaviour) {
        response.writeHead(misbehaviour.status).end();
      } else if ('nonsense' in misbehaviour) {
        send(response, 200, { hello: 'world' });
      } else if ('redirectTo' in misbehaviour) {
        response.writeHead(302, { location: misbehaviour.redirectTo }).end();
      } else {
        refuse(response, 200, misbehaviour.error);
      }
      return;
    }

    if (request.method === 'GET' && url.pathname === '/v4/user') {
      const account = accountOf(request, options);
      if (typeof account === 'string') {
        refuse(response, options.refusalStatus ?? 200, account);
        return;
      }
      const premiumUntil = account.premiumUntil ?? 0;
      send(response, 200, {
        status: 'success',
        data: {
          user: {
            username: account.username,
            email: `${account.username}@example.com`,
            isPremium: premiumUntil > 0,
            isSubscribed: false,
            isTrial: false,
            premiumUntil: options.timestampsAsText === true ? String(premiumUntil) : premiumUntil,
            lang: 'en',
            preferedDomain: 'com',
            fidelityPoints: 0,
            limitedHostersQuotas: {},
            notifications: [],
          },
        },
      });
      return;
    }

    refuse(response, 404, '404');
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    api: `http://127.0.0.1:${String(port)}`,
    requests,
    misbehave: (how) => {
      misbehaviour = how;
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
