import { createServer, type ServerResponse } from 'node:http';
import { createHash, type KeyObject } from 'node:crypto';
import { signDetached, type SignOptions } from './openpgp-signer.ts';

// A release as yt-dlp's project publishes one: its files by name, SHA2-256SUMS and its signature
// among them.
export type ReleaseFiles = Record<string, Buffer>;

// The files of a release whose sums are the builds' own and signed by `key`, as the release
// workflow of yt-dlp makes them. `sign` changes how it is signed; `sums` replaces what is signed.
export function signedRelease(
  builds: Readonly<Record<string, Buffer>>,
  key: KeyObject,
  options: SignOptions & { readonly sums?: string } = {},
): ReleaseFiles {
  const sums = Buffer.from(
    options.sums ??
      Object.entries(builds)
        .map(([name, bytes]) => `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`)
        .join(''),
  );
  return {
    ...builds,
    'SHA2-256SUMS': sums,
    'SHA2-256SUMS.sig': signDetached(sums, key, options),
  };
}

export type Misbehaviour =
  // Every request answered 503, as GitHub in an outage.
  | 'busy'
  // A request is taken and never answered.
  | 'silent'
  // The latest release is a page, not a redirect to its tag.
  | 'no-redirect';

export interface ReleasesServer {
  // What the engine is given as yt-dlp's releases: where `/releases/latest` is.
  readonly address: string;
  // Every path asked, in order.
  readonly asked: string[];
  latest: string | undefined;
  readonly releases: Map<string, ReleaseFiles>;
  misbehave: Misbehaviour | undefined;
  // A build sent this slowly, by pieces of 64 KB: a download that something can stop midway.
  pieceDelayMs: number;
  close(): Promise<void>;
}

// A real HTTP host that answers as github.com does for a project's releases: the latest release is
// a redirect to its tag's page, and a release's file a redirect to the host its bytes are on.
export async function startReleasesServer(): Promise<ReleasesServer> {
  const asked: string[] = [];
  const held = new Set<ServerResponse>();
  const state: Omit<ReleasesServer, 'close' | 'address'> = {
    asked,
    latest: undefined,
    releases: new Map(),
    misbehave: undefined,
    pieceDelayMs: 0,
  };

  const send = async (response: ServerResponse, bytes: Buffer) => {
    response.writeHead(200, { 'content-length': bytes.length });
    if (state.pieceDelayMs === 0) {
      response.end(bytes);
      return;
    }
    for (let at = 0; at < bytes.length && !response.destroyed; at += 64 * 1024) {
      response.write(bytes.subarray(at, at + 64 * 1024));
      await new Promise((done) => setTimeout(done, state.pieceDelayMs));
    }
    response.end();
  };

  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/');
    asked.push(path);
    if (state.misbehave === 'silent') {
      held.add(response);
      return;
    }
    if (state.misbehave === 'busy') {
      response.writeHead(503).end();
      return;
    }
    if (path === '/releases/latest') {
      if (state.latest === undefined) {
        response.writeHead(404).end();
      } else if (state.misbehave === 'no-redirect') {
        response.writeHead(200, { 'content-type': 'text/html' }).end('<html></html>');
      } else {
        response.writeHead(302, { location: `${address}/releases/tag/${state.latest}` }).end();
      }
      return;
    }
    const download = /^\/releases\/download\/([^/]+)\/([^/]+)$/.exec(path);
    if (download !== null) {
      const [, tag = '', name = ''] = download;
      const found = state.releases.get(tag)?.[name] !== undefined;
      response
        .writeHead(found ? 302 : 404, found ? { location: `${origin}/assets/${tag}/${name}` } : {})
        .end();
      return;
    }
    const asset = /^\/assets\/([^/]+)\/([^/]+)$/.exec(path);
    const bytes = asset === null ? undefined : state.releases.get(asset[1] ?? '')?.[asset[2] ?? ''];
    if (bytes === undefined) {
      response.writeHead(404).end();
      return;
    }
    void send(response, bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const where = server.address();
  const port = typeof where === 'object' && where !== null ? where.port : 0;
  const origin = `http://127.0.0.1:${String(port)}`;
  const address = origin;
  return Object.assign(state, {
    address,
    close: () =>
      new Promise<void>((resolve) => {
        for (const response of held) response.destroy();
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  });
}
