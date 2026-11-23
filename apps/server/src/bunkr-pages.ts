// What Scia reads of Bunkr's pages (docs/adr/0024): which links are its albums and its files'
// pages, and what those pages and its API say. The shapes are the ones gallery-dl's reader of
// Bunkr reads; nothing here was learned from Bunkr itself.

// The domains Bunkr has used, the old ones among them: the one list (the owner, #228). A link of
// one of them, or of one under `app.`, is Bunkr's; Bunkr on a new domain is a new entry here.
export const BUNKR_DOMAINS: readonly string[] = [
  'bunkr.ac',
  'bunkr.ci',
  'bunkr.cr',
  'bunkr.fi',
  'bunkr.ph',
  'bunkr.pk',
  'bunkr.ps',
  'bunkr.si',
  'bunkr.sk',
  'bunkr.ws',
  'bunkr.black',
  'bunkr.red',
  'bunkr.media',
  'bunkr.site',
  'bunkr.ax',
  'bunkr.cat',
  'bunkr.ru',
  'bunkr.su',
  'bunkr.la',
  'bunkr.is',
  'bunkr.to',
  'bunkrr.ru',
  'bunkrr.su',
];

export type BunkrLink =
  | { readonly kind: 'album'; readonly origin: string; readonly id: string }
  | { readonly kind: 'file'; readonly origin: string; readonly path: string };

const ALBUM_PATH = /^\/a\/([^/]+)\/?$/;
const FILE_PATH = /^\/[fvid]\/[^/]+\/?$/;

// Whether a host is one of the list's, or one of them under `app.`. Never a subdomain of another
// kind: the servers of Bunkr's files are not its pages.
export function isBunkrHost(hostname: string, domains: readonly string[] = BUNKR_DOMAINS): boolean {
  const host = hostname.toLowerCase();
  return domains.some((domain) => host === domain || host === `app.${domain}`);
}

// An album or a file's page of Bunkr, told by its host and the shape of its path; undefined for
// any other link.
export function bunkrLinkOf(
  url: string,
  domains: readonly string[] = BUNKR_DOMAINS,
): BunkrLink | undefined {
  let link: URL;
  try {
    link = new URL(url);
  } catch {
    return undefined;
  }
  if (link.protocol !== 'http:' && link.protocol !== 'https:') return undefined;
  if (!isBunkrHost(link.hostname, domains)) return undefined;
  const album = ALBUM_PATH.exec(link.pathname);
  if (album?.[1] !== undefined) return { kind: 'album', origin: link.origin, id: album[1] };
  if (FILE_PATH.test(link.pathname)) {
    return { kind: 'file', origin: link.origin, path: link.pathname.replace(/\/$/, '') };
  }
  return undefined;
}

const ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', '\u00a0'],
]);

function codePoint(value: number): string | undefined {
  return Number.isSafeInteger(value) && value > 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : undefined;
}

// The text an HTML attribute or element writes: its references made characters again, once.
function unescapeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      return codePoint(Number.parseInt(name.slice(2), 16)) ?? whole;
    }
    if (name.startsWith('#')) return codePoint(Number.parseInt(name.slice(1), 10)) ?? whole;
    return ENTITIES.get(name.toLowerCase()) ?? whole;
  });
}

// A string of Bunkr's script: JSON, but for `\'`, which JavaScript allows and JSON does not.
function scriptString(value: string): string | undefined {
  if (!/^"(?:[^"\\]|\\.)*"$/.test(value)) return undefined;
  try {
    const text: unknown = JSON.parse(
      value.replace(/\\([\\'])/g, (_, escaped: string) => (escaped === "'" ? "'" : '\\\\')),
    );
    return typeof text === 'string' ? text : undefined;
  } catch {
    return undefined;
  }
}

export interface AlbumPage {
  // What the album is called; nothing when its page does not say.
  readonly title: string | undefined;
  // In the album's order: each file's page, and the name the album gives it — a name from a
  // host, as hostile as any.
  readonly files: readonly { readonly slug: string; readonly name: string | undefined }[];
}

// `name: value,` read with no regular expression that backtracks: a host's line of spaces made
// one take time in the square of its length, on the engine's one thread.
function fieldOf(line: string): { name: string; value: string } | undefined {
  const colon = line.indexOf(':');
  if (colon === -1) return undefined;
  const name = line.slice(0, colon).trim();
  if (!/^\w+$/.test(name)) return undefined;
  const value = line.slice(colon + 1).trim();
  return { name, value: (value.endsWith(',') ? value.slice(0, -1) : value).trim() };
}

// The fields of each object of `window.albumFiles`, one a line. Anything else in the list —
// a line that is no field, two fields of one name, an object never closed — is a list Scia does
// not know: it would read the files wrongly, so it reads none.
function objectsOf(list: string): Map<string, string>[] | undefined {
  const objects: Map<string, string>[] = [];
  let current: Map<string, string> | undefined;
  for (const raw of list.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (line === '{') {
      if (current !== undefined) return undefined;
      current = new Map();
      continue;
    }
    if (line === '}' || line === '},') {
      if (current === undefined) return undefined;
      objects.push(current);
      current = undefined;
      continue;
    }
    if (line === '];' || line === ']') {
      if (current !== undefined) return undefined;
      return objects;
    }
    const field = fieldOf(line);
    if (current === undefined || field === undefined) return undefined;
    if (current.has(field.name)) return undefined;
    current.set(field.name, field.value);
  }
  return undefined;
}

// An album's page (`/a/<id>?advanced=1`): its title in `og:title`, which Bunkr escapes twice, and
// its files in `window.albumFiles`. Undefined for a page Scia cannot read as one.
export function readAlbumPage(html: string): AlbumPage | undefined {
  const start = /window\.albumFiles\s*=\s*\[/.exec(html);
  if (start === null) return undefined;
  const from = start.index + start[0].length;
  const end = html.indexOf('</script>', from);
  if (end === -1) return undefined;
  const objects = objectsOf(html.slice(from, end));
  if (objects === undefined) return undefined;
  const files: AlbumPage['files'][number][] = [];
  for (const object of objects) {
    const slug = scriptString(object.get('slug') ?? '');
    if (slug === undefined || slug === '') return undefined;
    const named = object.get('original') ?? object.get('name');
    const name = named === undefined ? undefined : scriptString(named);
    if (named !== undefined && name === undefined) return undefined;
    files.push({ slug, name });
  }
  const meta = /<meta\s+property="og:title"\s+content="([^"]*)"/i.exec(html)?.[1];
  const title = meta === undefined ? '' : unescapeHtml(unescapeHtml(meta)).trim();
  return { title: title === '' ? undefined : title, files };
}

export interface FilePage {
  // What Bunkr's API knows the file by.
  readonly id: string;
  // The name its page gives it, a name from a host; nothing when it gives none.
  readonly name: string | undefined;
}

function percentDecoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// A file's page (`/f/<slug>`): its id in `data-file-id`, its name in the first `<h1>`, which
// gallery-dl reads unescaped and percent-decoded. Undefined for a page that names no id.
export function readFilePage(html: string): FilePage | undefined {
  const id = /data-file-id="([^"]*)"/.exec(html)?.[1];
  if (id === undefined || !/^[\w-]{1,64}$/.test(id)) return undefined;
  // Its attributes cannot run past a `<`: a page of `<h1 ` never closed is read once, not once
  // from every `<h1`.
  const heading = /<h1(?:\s[^<>]*)?>([^<]*)</i.exec(html)?.[1];
  const name = heading === undefined ? '' : percentDecoded(unescapeHtml(heading)).trim();
  return { id, name: name === '' ? undefined : name };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// The link the API gives for a file: as it stands, or — `encrypted` — each byte XOR'd with
// `SECRET_KEY_<the answer's hour>`, in base64, which is what Bunkr's download page undoes in every
// visitor's browser. Undefined for an answer that is not one, or a link that is not http(s).
export function linkOfAnswer(answer: unknown): string | undefined {
  if (!isRecord(answer) || typeof answer.url !== 'string') return undefined;
  let link = answer.url;
  if (answer.encrypted === true) {
    const { timestamp } = answer;
    if (typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp) || timestamp < 0) {
      return undefined;
    }
    // What is not base64 is passed over by the decoding, and what comes out is no address.
    const key = Buffer.from(`SECRET_KEY_${String(Math.floor(timestamp / 3600))}`);
    const bytes = Buffer.from(link, 'base64');
    try {
      link = new TextDecoder('utf-8', { fatal: true }).decode(
        bytes.map((byte, index) => byte ^ (key[index % key.length] ?? 0)),
      );
    } catch {
      return undefined;
    }
  }
  try {
    const address = new URL(link);
    return address.protocol === 'http:' || address.protocol === 'https:' ? address.href : undefined;
  } catch {
    return undefined;
  }
}

// The names a file's link lands on while Bunkr's file server is in maintenance, as gallery-dl
// checks them: a short video that says so, which is not the file.
const MAINTENANCE = new Set(['maint.mp4', 'maintenance-vid.mp4']);

export function isMaintenance(fileName: string | undefined): boolean {
  return fileName !== undefined && MAINTENANCE.has(fileName.toLowerCase());
}
