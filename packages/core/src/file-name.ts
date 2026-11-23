export const FALLBACK_FILE_NAME = 'download';

const MAX_LENGTH = 200;
// Windows refuses these in a name; Linux refuses only the slash, and one name must do for both.
// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const LONGEST_EXTENSION = 10;

interface NameParts {
  readonly stem: string;
  // With its dot, or empty.
  readonly extension: string;
}

export function splitExtension(name: string): NameParts {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || name.length - dot > LONGEST_EXTENSION + 1) return { stem: name, extension: '' };
  const stem = name.slice(0, dot);
  const extension = name.slice(dot);
  // "archive.tar.gz" is one extension to whoever numbers a copy.
  if (stem.toLowerCase().endsWith('.tar') && stem.length > 4) {
    return { stem: stem.slice(0, -4), extension: `${stem.slice(-4)}${extension}` };
  }
  return { stem, extension };
}

function lastPathSegment(path: string): string {
  return path.split(/[/\\]/).at(-1) ?? '';
}

export function sanitizeFileName(raw: string): string {
  const cleaned = raw
    .replace(FORBIDDEN, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (cleaned === '') return FALLBACK_FILE_NAME;
  const { stem, extension } = splitExtension(cleaned);
  const safeStem = RESERVED.test(stem) ? `_${stem}` : stem;
  return `${safeStem.slice(0, MAX_LENGTH - extension.length)}${extension}`;
}

// What a host or a service calls a file, without any path it came with, made safe for the
// disk. Undefined when it gives no name.
export function fileNameFromHost(raw: string): string | undefined {
  const name = lastPathSegment(raw.trim());
  // A path's own steps are no name.
  return name === '' || name === '.' || name === '..' ? undefined : sanitizeFileName(name);
}

// The path of an address, without its query and fragment. Read by hand: the domain has no URL
// class, which belongs to the runtimes around it.
function pathOf(url: string): string {
  return /^[a-z][a-z\d+.-]*:\/\/[^/?#]+([^?#]*)/i.exec(url.trim())?.[1] ?? '';
}

export function fileNameFromUrl(url: string): string {
  const segment =
    pathOf(url)
      .split('/')
      .findLast((part) => part !== '') ?? '';
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // A stray "%" is not an encoding: the segment stays as it is written.
  }
  return sanitizeFileName(lastPathSegment(decoded));
}

function unquote(value: string): string {
  const trimmed = value.trim();
  // Only the escaped quote is undone: a backslash is more often a Windows path than an escape,
  // and the path is cut away by the caller.
  return trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2
    ? trimmed.slice(1, -1).replace(/\\"/g, '"')
    : trimmed;
}

// RFC 6266: "filename*" carries the encoded name and wins over the plain "filename".
export function fileNameFromContentDisposition(header: string): string | undefined {
  const extended = /filename\*\s*=\s*[\w-]*'[^']*'([^;]+)/i.exec(header)?.[1];
  if (extended !== undefined) {
    try {
      return sanitizeFileName(lastPathSegment(decodeURIComponent(extended.trim())));
    } catch {
      // Falls back to the plain parameter.
    }
  }
  const plain = /filename\s*=\s*("(?:[^"\\]|\\.)*"|[^;]+)/i.exec(header)?.[1];
  if (plain === undefined) return undefined;
  const name = lastPathSegment(unquote(plain));
  return name === '' ? undefined : sanitizeFileName(name);
}

// The names a folder already holds: those of the downloads on their way there (lower case, as
// Windows compares them), and the files on its disk.
export interface UsedNames {
  readonly inList: ReadonlySet<string>;
  readonly onDisk: (name: string) => boolean;
}

// Whether a download may not take `name` in a folder. A download keeps files beside its name
// while it runs (`working`: its part file, a stream's pieces, a pair's picture and sound), and no
// other file may stand under those names: a name is taken when it is used, when one of its working
// names is, and when it is itself a working name of a download in the list. A file that is done
// has nothing beside it.
export function isNameTaken(name: string, used: UsedNames, working: readonly string[]): boolean {
  const lower = name.toLowerCase();
  if (used.inList.has(lower) || used.onDisk(name)) return true;
  return working.some((suffix) => {
    const beside = `${name}${suffix}`;
    if (used.inList.has(beside.toLowerCase()) || used.onDisk(beside)) return true;
    const ending = suffix.toLowerCase();
    return lower.endsWith(ending) && used.inList.has(lower.slice(0, lower.length - ending.length));
  });
}

// "film.mkv", then "film (1).mkv", "film (2).mkv"…
export function uniqueFileName(name: string, isTaken: (candidate: string) => boolean): string {
  if (!isTaken(name)) return name;
  const { stem, extension } = splitExtension(name);
  for (let copy = 1; ; copy += 1) {
    const candidate = `${stem} (${String(copy)})${extension}`;
    if (!isTaken(candidate)) return candidate;
  }
}
