import { DEFAULT_API_PORT } from '@scia/contracts';
import { ALLDEBRID_API } from './alldebrid.ts';

export interface ServerConfig {
  readonly port: number;
  readonly apiToken: string;
  // The engine's own files: its state and the token of the browser extension.
  readonly dataDir: string;
  // Where a download lands until the person chooses another folder.
  readonly downloadDir: string;
  // The built renderer; absent under the dev server, where Vite serves it.
  readonly staticDir: string | undefined;
  readonly version: string;
  // Where AllDebrid answers: its own address, unless a run names a simulated service.
  readonly alldebridApi: string;
  // The yt-dlp that reads the page of a video (docs/adr/0008); without one, a page is fetched as
  // it stands — under plain Node, and where Scia ships no build of it.
  readonly ytDlp: string | undefined;
}

// The key of the person's account goes wherever this address says. It is replaced only by an
// address on this computer — the simulated service of a run — so that no variable can send a
// key to another machine.
function serviceAddress(given: string | undefined, name: string, real: string): string {
  if (given === undefined || given === '') return real;
  const address = URL.canParse(given) ? new URL(given) : undefined;
  if (
    address?.protocol !== 'http:' ||
    (address.hostname !== '127.0.0.1' && address.hostname !== 'localhost') ||
    address.username !== ''
  ) {
    throw new Error(`${name} must be an http address on this computer.`);
  }
  return address.origin;
}

const MIN_TOKEN_LENGTH = 16;

function required(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required.`);
  return value;
}

export function parseConfig(env: Readonly<Record<string, string | undefined>>): ServerConfig {
  const apiToken = required(env, 'SCIA_API_TOKEN');
  if (apiToken.length < MIN_TOKEN_LENGTH) {
    throw new Error(`SCIA_API_TOKEN must be at least ${String(MIN_TOKEN_LENGTH)} characters.`);
  }
  const rawPort = env.SCIA_PORT ?? String(DEFAULT_API_PORT);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`SCIA_PORT is not a port: ${rawPort}`);
  }
  const staticDir = env.SCIA_STATIC_DIR;
  const ytDlp = env.SCIA_YT_DLP;
  return {
    port,
    apiToken,
    dataDir: required(env, 'SCIA_DATA_DIR'),
    downloadDir: required(env, 'SCIA_DOWNLOAD_DIR'),
    staticDir: staticDir === undefined || staticDir === '' ? undefined : staticDir,
    version: env.SCIA_VERSION ?? '0.0.0',
    alldebridApi: serviceAddress(env.SCIA_ALLDEBRID_API, 'SCIA_ALLDEBRID_API', ALLDEBRID_API),
    ytDlp: ytDlp === undefined || ytDlp === '' ? undefined : ytDlp,
  };
}
