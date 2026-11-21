import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import {
  addDownloadsSchema,
  API_PREFIX,
  ApiErrorCode,
  connectIntegrationSchema,
  downloadFolderSchema,
  EVENTS_KEEP_ALIVE_MS,
  type Health,
  isIntegrationId,
  offerLinksSchema,
  type Pairing,
  settingsPatchSchema,
  SNAPSHOT_EVENT,
} from '@scia/contracts';
import type { Theme } from '@scia/contracts/theme';
import { isServiceFailure, ServiceFailure } from '@scia/core';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { type DownloadManager, ManagerError, ManagerRefusal } from './download-manager.ts';
import { CodeConflictError, type Integrations, KeyNotKeptError } from './integrations.ts';
import { describeFailure, type Logger } from './logger.ts';
import { ServiceError } from './service-error.ts';

// How often a page hears of a running download: four times a second reads as continuous.
const SNAPSHOT_INTERVAL_MS = 250;

// The page names its theme from the first paint: its colours wait for no script, and for no
// answer of the engine.
function wearing(page: string, theme: Theme): string {
  return page.replace(/<html([^>]*)>/, `<html$1 data-theme="${theme}">`);
}

export interface AppDeps {
  readonly manager: DownloadManager;
  readonly integrations: Integrations;
  // The desktop app's own token: every route.
  readonly apiToken: string;
  // The browser extension's token: it may add downloads and nothing else (docs/adr/0002).
  readonly extensionToken: string;
  readonly version: string;
  // The port the engine listens on, known only once it does.
  readonly port: () => number;
  readonly staticDir: string | undefined;
  readonly logger: Logger;
  // How long GET /events stays silent before it says it is still there; the contract's, but
  // for a spec.
  readonly eventsKeepAliveMs?: number;
}

// A comment of the event stream: no reader takes it for an event.
const STILL_HERE = ': idle\n\n';

const Caller = { App: 'app', Extension: 'extension' } as const;
type Caller = (typeof Caller)[keyof typeof Caller];

// Everything the browser extension's token opens: adding downloads, and asking whether the
// token is still the one. It reads nothing and changes nothing else.
const EXTENSION_ROUTES: ReadonlySet<string> = new Set([
  `POST ${API_PREFIX}/downloads`,
  `GET ${API_PREFIX}/extension/check`,
]);

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sameToken(given: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

function fail(status: number, code: ApiErrorCode, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export function createApp(deps: AppDeps): Hono {
  const { manager, integrations } = deps;
  const app = new Hono();

  // A page of any site can make the browser call 127.0.0.1 under a host name of its own (DNS
  // rebinding): only the engine's real address is answered.
  app.use('*', async (c, next) => {
    const host = new URL(c.req.url).host;
    const port = String(deps.port());
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      return fail(403, ApiErrorCode.Forbidden, 'Unknown host.');
    }
    await next();
    return undefined;
  });

  app.get(`${API_PREFIX}/health`, (c) => {
    const health: Health = { name: 'scia', version: deps.version };
    return c.json({ data: health });
  });

  app.use(`${API_PREFIX}/*`, async (c, next) => {
    const token = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1];
    if (token === undefined) {
      return fail(401, ApiErrorCode.Unauthorized, 'A token is required.');
    }
    const caller = sameToken(token, deps.apiToken)
      ? Caller.App
      : sameToken(token, deps.extensionToken)
        ? Caller.Extension
        : undefined;
    if (caller === undefined) {
      return fail(401, ApiErrorCode.Unauthorized, 'Unknown token.');
    }
    const route = `${c.req.method} ${c.req.path}`;
    if (caller === Caller.Extension && !EXTENSION_ROUTES.has(route)) {
      return fail(403, ApiErrorCode.Forbidden, 'The extension only adds downloads.');
    }
    await next();
    return undefined;
  });

  app.get(`${API_PREFIX}/downloads`, (c) => c.json({ data: manager.snapshot().downloads }));

  app.post(`${API_PREFIX}/downloads`, async (c) => {
    const parsed = addDownloadsSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return fail(400, ApiErrorCode.InvalidRequest, 'Give one or more http(s) addresses.');
    }
    return c.json({ data: manager.add(parsed.data) }, 201);
  });

  // The links main read on the clipboard (docs/adr/0012): the app's token only, as every route
  // the extension's does not name.
  app.post(`${API_PREFIX}/downloads/offered`, async (c) => {
    const parsed = offerLinksSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return fail(400, ApiErrorCode.InvalidRequest, 'Give one or more http(s) addresses.');
    }
    return c.json({ data: await manager.offer(parsed.data.urls) });
  });

  app.post(`${API_PREFIX}/downloads/start-ready`, (c) => c.json({ data: manager.startReady() }));

  app.get(`${API_PREFIX}/downloads/:id`, (c) => c.json({ data: manager.find(c.req.param('id')) }));

  app.post(`${API_PREFIX}/downloads/:id/start`, (c) =>
    c.json({ data: manager.start(c.req.param('id')) }),
  );

  app.post(`${API_PREFIX}/downloads/:id/pause`, async (c) =>
    c.json({ data: await manager.pause(c.req.param('id')) }),
  );

  app.post(`${API_PREFIX}/downloads/:id/resume`, (c) =>
    c.json({ data: manager.resume(c.req.param('id')) }),
  );

  app.delete(`${API_PREFIX}/downloads/:id`, async (c) => {
    await manager.remove(c.req.param('id'), c.req.query('deleteFile') === 'true');
    return c.body(null, 204);
  });

  app.get(`${API_PREFIX}/events`, (c) =>
    streamSSE(c, async (stream) => {
      // Ends the wait for a change when whoever listens has gone: a stream that closed leaves
      // no waiter behind in the manager.
      const gone = new AbortController();
      stream.onAbort(() => {
        gone.abort();
      });
      // The stream is never silent for long (EVENTS_KEEP_ALIVE_MS): a comment says the engine
      // is there, with nothing to send or between two lists.
      const stillHere = setInterval(() => {
        void stream.write(STILL_HERE);
      }, deps.eventsKeepAliveMs ?? EVENTS_KEEP_ALIVE_MS);
      try {
        let version = -1;
        while (!stream.aborted && !stream.closed) {
          version = await manager.nextChange(version, gone.signal);
          if (gone.signal.aborted) return;
          await stream.writeSSE({
            event: SNAPSHOT_EVENT,
            data: JSON.stringify(manager.snapshot()),
          });
          await stream.sleep(SNAPSHOT_INTERVAL_MS);
        }
      } finally {
        clearInterval(stillHere);
        gone.abort();
      }
    }),
  );

  app.get(`${API_PREFIX}/settings`, (c) => c.json({ data: manager.settings() }));

  app.patch(`${API_PREFIX}/settings`, async (c) => {
    const parsed = settingsPatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return fail(400, ApiErrorCode.InvalidRequest, 'Not a setting, or out of its range.');
    }
    return c.json({ data: manager.updateSettings(parsed.data) });
  });

  // The folder is named by main, which showed the person the system's dialog: never among
  // the settings the page patches.
  app.put(`${API_PREFIX}/settings/download-directory`, async (c) => {
    const parsed = downloadFolderSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return fail(400, ApiErrorCode.InvalidRequest, 'Name the folder.');
    }
    return c.json({ data: await manager.setDownloadDirectory(parsed.data.directory) });
  });

  app.get(`${API_PREFIX}/integrations`, async (c) => c.json({ data: await integrations.list() }));

  // The key comes in and never goes back out: no route answers it.
  app.put(`${API_PREFIX}/integrations/:id`, async (c) => {
    const id = c.req.param('id');
    if (!isIntegrationId(id)) return fail(404, ApiErrorCode.NotFound, 'No such service.');
    const parsed = connectIntegrationSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return fail(400, ApiErrorCode.InvalidRequest, 'Give the key of the service.');
    }
    return c.json({ data: await integrations.connect(id, parsed.data.apiKey) });
  });

  app.delete(`${API_PREFIX}/integrations/:id`, async (c) => {
    const id = c.req.param('id');
    if (!isIntegrationId(id)) return fail(404, ApiErrorCode.NotFound, 'No such service.');
    await integrations.disconnect(id);
    return c.body(null, 204);
  });

  // A code to confirm on the service's site (#136): what the service gives the key for stays in
  // the engine, and the key it gives is connected as a pasted one is.
  app.post(`${API_PREFIX}/integrations/:id/code`, async (c) => {
    const id = c.req.param('id');
    if (!isIntegrationId(id)) return fail(404, ApiErrorCode.NotFound, 'No such service.');
    return c.json({ data: await integrations.startCode(id) }, 201);
  });

  app.get(`${API_PREFIX}/integrations/:id/code`, (c) => {
    const id = c.req.param('id');
    if (!isIntegrationId(id)) return fail(404, ApiErrorCode.NotFound, 'No such service.');
    const code = integrations.code(id);
    if (code === undefined) return fail(404, ApiErrorCode.NotFound, 'No code was given.');
    return c.json({ data: code });
  });

  app.delete(`${API_PREFIX}/integrations/:id/code`, (c) => {
    const id = c.req.param('id');
    if (!isIntegrationId(id)) return fail(404, ApiErrorCode.NotFound, 'No such service.');
    // A code may be named: only that one is forgotten.
    integrations.cancelCode(id, c.req.query('code'));
    return c.body(null, 204);
  });

  app.get(`${API_PREFIX}/extension/pairing`, (c) => {
    const pairing: Pairing = { token: deps.extensionToken, port: deps.port() };
    return c.json({ data: pairing });
  });

  app.get(`${API_PREFIX}/extension/check`, (c) => c.body(null, 204));

  app.all(`${API_PREFIX}/*`, () => fail(404, ApiErrorCode.NotFound, 'No such route.'));

  // The renderer: its files by name, its page for every other address.
  app.get('*', async (c) => {
    const { staticDir } = deps;
    if (staticDir === undefined) return c.notFound();
    const requested = join(staticDir, normalize(decodeURIComponent(c.req.path)));
    const isAsset = requested.startsWith(`${staticDir}${sep}`) && extname(requested) !== '';
    const page = join(staticDir, 'index.html');
    const file = isAsset ? requested : page;
    try {
      // The page is the one file served wearing something, also when it is asked for by name.
      const body =
        file === page
          ? wearing(await readFile(file, 'utf8'), manager.settings().theme)
          : new Uint8Array(await readFile(file));
      return c.body(body, 200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-cache',
      });
    } catch {
      return c.notFound();
    }
  });

  app.onError((error, c) => {
    if (error instanceof ManagerError) {
      if (error.refusal === ManagerRefusal.NotFound) {
        return fail(404, ApiErrorCode.NotFound, error.message);
      }
      return error.refusal === ManagerRefusal.Invalid
        ? fail(400, ApiErrorCode.InvalidRequest, error.message)
        : fail(409, ApiErrorCode.Conflict, error.message);
    }
    if (error instanceof ServiceError) {
      // The service was asked and said no (422), or could not be asked (502).
      // A refusal that is about a link has no place here: only a key is given on this API.
      const failure = isServiceFailure(error.failure) ? error.failure : ServiceFailure.Unavailable;
      const status = failure === ServiceFailure.Unavailable ? 502 : 422;
      return fail(status, failure, error.message);
    }
    if (error instanceof CodeConflictError) {
      return fail(409, ApiErrorCode.Conflict, error.message);
    }
    if (error instanceof KeyNotKeptError) {
      return fail(500, ApiErrorCode.KeyNotKept, error.message);
    }
    deps.logger.error('request_failed', { path: c.req.path, error: describeFailure(error) });
    return fail(500, ApiErrorCode.InternalError, 'The engine failed on this request.');
  });

  return app;
}
