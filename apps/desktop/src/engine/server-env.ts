import { ENGINE_THREADPOOL_SIZE } from '@scia/contracts';
import type { RuntimeLayout } from './runtime-layout.ts';

export interface ServerEnvInput {
  readonly layout: RuntimeLayout;
  readonly apiToken: string;
  readonly port: number;
  readonly version: string;
  readonly systemRoot: string | undefined;
  // The system's folder for temporary files: what the engine's own programs (yt-dlp) write there.
  readonly tempDir: string;
  // A simulated AllDebrid for this run (engine/launch-options.ts); the engine refuses one that
  // is not on this computer.
  readonly alldebridApi?: string | undefined;
  // A host of yt-dlp's releases for this run (engine/launch-options.ts); the engine refuses one
  // that is not on this computer.
  readonly ytDlpReleases?: string | undefined;
  // A host that answers as Bunkr does, for this run (engine/launch-options.ts); the engine
  // refuses one that is not on this computer.
  readonly bunkr?: string | undefined;
}

// Built from scratch, never from `process.env`: inherited variables silently override
// configuration. `SystemRoot` is the one OS variable kept — Windows networking needs it.
// `UV_THREADPOOL_SIZE` is Scia's own value, not inherited: Node reads it once, as it starts.
export function buildServerEnv(input: ServerEnvInput): Record<string, string> {
  return {
    SCIA_API_TOKEN: input.apiToken,
    SCIA_PORT: String(input.port),
    SCIA_DATA_DIR: input.layout.dataDir,
    SCIA_DOWNLOAD_DIR: input.layout.downloadDir,
    SCIA_STATIC_DIR: input.layout.rendererDir,
    SCIA_VERSION: input.version,
    SCIA_TEMP_DIR: input.tempDir,
    UV_THREADPOOL_SIZE: String(ENGINE_THREADPOOL_SIZE),
    ...(input.alldebridApi === undefined ? {} : { SCIA_ALLDEBRID_API: input.alldebridApi }),
    ...(input.ytDlpReleases === undefined ? {} : { SCIA_YT_DLP_RELEASES: input.ytDlpReleases }),
    ...(input.bunkr === undefined ? {} : { SCIA_BUNKR: input.bunkr }),
    ...(input.layout.ytDlp === undefined
      ? {}
      : {
          SCIA_YT_DLP: input.layout.ytDlp.path,
          SCIA_YT_DLP_VERSION: input.layout.ytDlp.version,
          SCIA_YT_DLP_ASSET: input.layout.ytDlp.asset,
        }),
    ...(input.systemRoot === undefined ? {} : { SystemRoot: input.systemRoot }),
  };
}
