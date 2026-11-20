import { join } from 'node:path';

export interface RuntimeLayout {
  readonly serverEntry: string;
  readonly rendererDir: string;
  // The engine's own files: its state, the token of the browser extension.
  readonly dataDir: string;
  readonly logsDir: string;
  // Where downloads land until the person chooses another folder.
  readonly downloadDir: string;
  // The notices this computer was already shown (engine/shown-notices.ts).
  readonly noticesPath: string;
  // The keys of the connected services, each sealed by the system (engine/key-vault.ts).
  readonly keysDir: string;
  // yt-dlp, which reads the page of a video (docs/adr/0009); undefined on a system Scia ships
  // no build of it for, where pages are fetched as they stand.
  readonly ytDlp: string | undefined;
}

// The folder of each system's tools — electron-builder's name of the system, which `tools/${os}`
// in electron-builder.yml also gives — and the name yt-dlp has in it. The one place these are
// written: scripts/fetch-tools.ts fetches into them.
export const YT_DLP_OF_PLATFORM: Readonly<
  Partial<Record<NodeJS.Platform, { readonly os: string; readonly file: string }>>
> = {
  win32: { os: 'win', file: 'yt-dlp.exe' },
  linux: { os: 'linux', file: 'yt-dlp' },
};

export interface LayoutInput {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly appRoot: string;
  readonly userDataDir: string;
  // The system's Downloads folder.
  readonly downloadsDir: string;
  // A run with its own profile keeps its files there too, away from the person's Downloads.
  readonly scratchProfile: boolean;
  readonly platform: NodeJS.Platform;
}

// Packaged paths mirror electron-builder.yml `extraResources`: change both together.
export function resolveRuntimeLayout(input: LayoutInput): RuntimeLayout {
  const data = {
    dataDir: join(input.userDataDir, 'engine'),
    logsDir: join(input.userDataDir, 'logs'),
    noticesPath: join(input.userDataDir, 'notices.json'),
    keysDir: join(input.userDataDir, 'keys'),
    downloadDir: input.scratchProfile ? join(input.userDataDir, 'downloads') : input.downloadsDir,
  };
  const tool = YT_DLP_OF_PLATFORM[input.platform];
  if (input.isPackaged) {
    return {
      serverEntry: join(input.resourcesPath, 'server', 'server.cjs'),
      rendererDir: join(input.resourcesPath, 'renderer'),
      ytDlp: tool === undefined ? undefined : join(input.resourcesPath, 'tools', tool.file),
      ...data,
    };
  }
  return {
    serverEntry: join(input.appRoot, '..', 'server', 'dist', 'server.cjs'),
    rendererDir: join(input.appRoot, '..', 'renderer', 'dist'),
    ytDlp: tool === undefined ? undefined : join(input.appRoot, 'tools', tool.os, tool.file),
    ...data,
  };
}
