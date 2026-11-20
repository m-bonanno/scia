import { isAbsolute, resolve } from 'node:path';

export interface LaunchOptions {
  // Every run that is not the installed app passes one, so it never touches the real profile.
  readonly userDataDir: string | undefined;
  // The engine's port for this run; the installed app keeps the one the extension knows.
  readonly port: number | undefined;
  // A simulated AllDebrid, for a run that must not reach the real one. The engine takes only an
  // address on this computer, and does not start with any other.
  readonly alldebridApi: string | undefined;
  // A host that answers as yt-dlp's releases do, for a run that must not reach GitHub. The engine
  // takes only an address on this computer, and does not start with any other.
  readonly ytDlpReleases: string | undefined;
}

const USER_DATA_DIR = '--user-data-dir=';
const PORT = '--port=';
const ALLDEBRID_API = '--alldebrid-api=';
const YT_DLP_RELEASES = '--yt-dlp-releases=';

function valueOf(argv: readonly string[], prefix: string): string | undefined {
  const value = argv
    .find((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length)
    .replace(/^"(.*)"$/, '$1');
  return value === undefined || value === '' ? undefined : value;
}

export function parseLaunchOptions(argv: readonly string[], cwd: string): LaunchOptions {
  const rawDir = valueOf(argv, USER_DATA_DIR);
  const port = Number(valueOf(argv, PORT));
  return {
    userDataDir:
      rawDir === undefined ? undefined : isAbsolute(rawDir) ? rawDir : resolve(cwd, rawDir),
    port: Number.isInteger(port) && port >= 0 && port <= 65_535 ? port : undefined,
    alldebridApi: valueOf(argv, ALLDEBRID_API),
    ytDlpReleases: valueOf(argv, YT_DLP_RELEASES),
  };
}
