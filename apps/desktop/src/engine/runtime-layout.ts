import { join } from 'node:path';

export interface RuntimeLayout {
  readonly serverEntry: string;
  readonly rendererDir: string;
  // The engine's own files: its state, the token of the browser extension.
  readonly dataDir: string;
  readonly logsDir: string;
  // Where downloads land until the person chooses another folder.
  readonly downloadDir: string;
}

export interface LayoutInput {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly appRoot: string;
  readonly userDataDir: string;
  // The system's Downloads folder.
  readonly downloadsDir: string;
  // A run with its own profile keeps its files there too, away from the person's Downloads.
  readonly scratchProfile: boolean;
}

// Packaged paths mirror electron-builder.yml `extraResources`: change both together.
export function resolveRuntimeLayout(input: LayoutInput): RuntimeLayout {
  const data = {
    dataDir: join(input.userDataDir, 'engine'),
    logsDir: join(input.userDataDir, 'logs'),
    downloadDir: input.scratchProfile ? join(input.userDataDir, 'downloads') : input.downloadsDir,
  };
  if (input.isPackaged) {
    return {
      serverEntry: join(input.resourcesPath, 'server', 'server.cjs'),
      rendererDir: join(input.resourcesPath, 'renderer'),
      ...data,
    };
  }
  return {
    serverEntry: join(input.appRoot, '..', 'server', 'dist', 'server.cjs'),
    rendererDir: join(input.appRoot, '..', 'renderer', 'dist'),
    ...data,
  };
}
