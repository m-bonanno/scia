import { DEFAULT_API_PORT } from '@scia/contracts';

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
  return {
    port,
    apiToken,
    dataDir: required(env, 'SCIA_DATA_DIR'),
    downloadDir: required(env, 'SCIA_DOWNLOAD_DIR'),
    staticDir: staticDir === undefined || staticDir === '' ? undefined : staticDir,
    version: env.SCIA_VERSION ?? '0.0.0',
  };
}
