import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

// A file of a simulated album: its page's slug, the id its page and the API know it by, and
// where its bytes are (a local host's link).
export interface SimulatedFile {
  readonly id: string;
  readonly slug: string;
  // The name it was uploaded with; the album may give only the name it is stored under.
  readonly original?: string;
  readonly name?: string;
  // What its own page's heading says, when not the name it was uploaded with.
  readonly heading?: string;
  readonly link: string;
  // False for an API answer that gives the link as it stands.
  readonly encrypted?: boolean;
}

export interface SimulatedAlbum {
  readonly title?: string;
  readonly files: readonly SimulatedFile[];
}

export interface BunkrServerOptions {
  // By id: the album at `/a/<id>`.
  readonly albums: Readonly<Record<string, SimulatedAlbum>>;
  // Paths answered with this status and no body, the API's (`/api/_001_v2`) among them. Read at
  // every request: a spec changes it to mend the host.
  readonly status?: Record<string, number>;
  // A wait before every answer.
  readonly delayMs?: number;
  // Paths answered with a redirect to this address.
  readonly redirects?: Readonly<Record<string, string>>;
  // Paths answered with this page, as it stands.
  readonly pages?: Readonly<Record<string, string>>;
  // What the API answers instead of a file's link.
  readonly apiAnswer?: string;
}

export interface BunkrServer {
  // The site's address: albums at `<url>/a/<id>`, files at `<url>/f/<slug>`.
  readonly url: string;
  // Its API's, as Scia is told it.
  readonly api: string;
  // Every request, in order.
  readonly asked: {
    readonly method: string | undefined;
    readonly path: string;
    // With its `?`, or empty.
    readonly query: string;
    readonly referer: string | undefined;
    readonly origin: string | undefined;
    readonly userAgent: string | undefined;
    readonly body: string;
  }[];
  close(): Promise<void>;
}

// What the API dates its answers with; the key that undoes its XOR is of the same hour.
const TIMESTAMP = 1_795_000_000;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// A string as Bunkr's script writes one: JSON, with `'` escaped as JavaScript allows (gallery-dl
// turns `\'` back into `'` before it reads it as JSON).
function scriptString(text: string): string {
  return JSON.stringify(text).replace(/'/g, "\\'");
}

// An album's page in the shape gallery-dl's reader of Bunkr reads (docs/adr/0024): its title in
// `og:title`, escaped twice, and its files in `window.albumFiles`, one field a line.
export function albumPageOf(album: SimulatedAlbum): string {
  const files = album.files.map((file) =>
    [
      '{',
      ` id: ${file.id},`,
      ` name: ${scriptString(file.name ?? `${file.slug}-0123456789ab.bin`)},`,
      ...(file.original === undefined ? [] : [` original: ${scriptString(file.original)},`]),
      ` slug: ${scriptString(file.slug)},`,
      ' type: "application/octet-stream",',
      ' size:  1234 ,',
      ' timestamp: "12:00:00 21/11/2026"',
      '}',
    ].join('\n'),
  );
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    ...(album.title === undefined
      ? []
      : [`<meta property="og:title" content="${escapeHtml(escapeHtml(album.title))}">`]),
    '<title>Bunkr</title>',
    '</head>',
    '<body>',
    '<span class="font-semibold">(1.2 KB)</span>',
    '<script>',
    'window.albumFiles = [',
    files.join(',\n'),
    '];',
    '</script>',
    '</body>',
    '</html>',
  ].join('\n');
}

// A file's page, as gallery-dl reads one: its id in `data-file-id`, its name in the first `<h1>`.
// `name` is written as it stands: HTML, escaped or not.
export function filePageOf(file: { readonly id: string; readonly name: string }): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<body>',
    `<h1 class="text-subs font-semibold">${file.name}</h1>`,
    `<a class="btn" href="https://get.bunkrr.su/file/${file.id}" data-file-id="${file.id}">Download</a>`,
    '</body>',
    '</html>',
  ].join('\n');
}

// The link as the API hides it: each byte XOR'd with `SECRET_KEY_<hour of the answer>`, in base64.
function hidden(link: string): string {
  const key = Buffer.from(`SECRET_KEY_${String(Math.floor(TIMESTAMP / 3600))}`);
  const bytes = Buffer.from(link);
  return Buffer.from(bytes.map((byte, index) => byte ^ (key[index % key.length] ?? 0))).toString(
    'base64',
  );
}

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

// A real HTTP host that answers as Bunkr does, as far as gallery-dl's source says (docs/adr/0024):
// its album pages, its files' pages and its API, on a free local port. Never the real site.
export async function startBunkrServer(options: BunkrServerOptions): Promise<BunkrServer> {
  const asked: BunkrServer['asked'][number][] = [];
  const files = Object.values(options.albums).flatMap((album) => album.files);
  const server = createServer((request, response) => {
    void (async () => {
      const body = await bodyOf(request);
      const address = request.url ?? '/';
      const path = address.split('?')[0] ?? '/';
      asked.push({
        method: request.method,
        path,
        query: address.slice(path.length),
        referer: request.headers.referer,
        origin: request.headers.origin,
        userAgent: request.headers['user-agent'],
        body,
      });
      // After the request is counted: a spec that sees it asked has the whole wait to act in.
      if (options.delayMs !== undefined) await sleep(options.delayMs);
      const status = options.status?.[path];
      if (status !== undefined) {
        response.writeHead(status).end();
        return;
      }
      const location = options.redirects?.[path];
      if (location !== undefined) {
        response.writeHead(302, { location }).end();
        return;
      }
      const html = (page: string) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
      };
      const page = options.pages?.[path];
      if (page !== undefined) {
        html(page);
        return;
      }
      if (request.method === 'POST' && path === '/api/_001_v2') {
        const answer =
          options.apiAnswer ??
          (() => {
            const id = (JSON.parse(body) as { id?: unknown }).id;
            const file = files.find((each) => each.id === id);
            if (file === undefined) return undefined;
            return JSON.stringify(
              file.encrypted === false
                ? { encrypted: false, url: file.link }
                : { encrypted: true, timestamp: TIMESTAMP, url: hidden(file.link) },
            );
          })();
        if (answer === undefined) {
          response.writeHead(400).end();
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' }).end(answer);
        return;
      }
      const album = /^\/a\/([^/]+)$/.exec(path);
      if (request.method === 'GET' && album !== null) {
        const found = options.albums[album[1] ?? ''];
        if (found === undefined) response.writeHead(404).end();
        else html(albumPageOf(found));
        return;
      }
      const file = /^\/[fvid]\/([^/]+)$/.exec(path);
      const found = files.find((each) => each.slug === file?.[1]);
      if (request.method === 'GET' && found !== undefined) {
        html(
          filePageOf({
            id: found.id,
            name: escapeHtml(found.heading ?? found.original ?? found.name ?? found.slug),
          }),
        );
        return;
      }
      response.writeHead(404).end();
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${String(port)}`;
  return {
    url,
    api: `${url}/api/_001_v2`,
    asked,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
