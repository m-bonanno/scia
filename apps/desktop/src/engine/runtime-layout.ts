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
  // yt-dlp, which reads the page of a video (docs/adr/0009), and what the engine needs to bring it
  // up to date (docs/adr/0011); undefined on a system Scia ships no build of it for, where pages
  // are fetched as they stand.
  readonly ytDlp: ShippedYtDlp | undefined;
}

export interface ShippedYtDlp {
  readonly path: string;
  // The release of yt-dlp it is.
  readonly version: string;
  // Its name in a release of yt-dlp.
  readonly asset: string;
}

// The release of yt-dlp Scia ships. Changed with every checksum below, from that release's
// SHA2-256SUMS.
export const YT_DLP_VERSION = '2026.10.26';

// For each system: the folder of its tools — electron-builder's name of the system, which
// `tools/${os}` in electron-builder.yml also gives — the name yt-dlp has in it, its build's name in
// the release and that build's checksum. The one place these are written: scripts/fetch-tools.ts
// fetches into them, and the engine brings the build up to date by them.
export const YT_DLP_OF_PLATFORM: Readonly<
  Partial<
    Record<
      NodeJS.Platform,
      {
        readonly os: string;
        readonly file: string;
        readonly asset: string;
        readonly sha256: string;
      }
    >
  >
> = {
  win32: {
    os: 'win',
    file: 'yt-dlp.exe',
    asset: 'yt-dlp.exe',
    sha256: 'f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d',
  },
  linux: {
    os: 'linux',
    file: 'yt-dlp',
    asset: 'yt-dlp_linux',
    sha256: '767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795',
  },
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
  // The build shipped for this system, in the folder its tools are in.
  const ytDlpIn = (folder: (os: string) => string): ShippedYtDlp | undefined =>
    tool === undefined
      ? undefined
      : { path: join(folder(tool.os), tool.file), version: YT_DLP_VERSION, asset: tool.asset };
  if (input.isPackaged) {
    return {
      serverEntry: join(input.resourcesPath, 'server', 'server.cjs'),
      rendererDir: join(input.resourcesPath, 'renderer'),
      ytDlp: ytDlpIn(() => join(input.resourcesPath, 'tools')),
      ...data,
    };
  }
  return {
    serverEntry: join(input.appRoot, '..', 'server', 'dist', 'server.cjs'),
    rendererDir: join(input.appRoot, '..', 'renderer', 'dist'),
    ytDlp: ytDlpIn((os) => join(input.appRoot, 'tools', os)),
    ...data,
  };
}
