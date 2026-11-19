import { isAbsolute, resolve } from 'node:path';

export interface LaunchOptions {
  // Every run that is not the installed app passes one, so it never touches the real profile.
  readonly userDataDir: string | undefined;
  // The engine's port for this run; the installed app keeps the one the extension knows.
  readonly port: number | undefined;
}

const USER_DATA_DIR = '--user-data-dir=';
const PORT = '--port=';

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
  };
}
