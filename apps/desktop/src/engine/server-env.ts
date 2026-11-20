import type { RuntimeLayout } from './runtime-layout.ts';

export interface ServerEnvInput {
  readonly layout: RuntimeLayout;
  readonly apiToken: string;
  readonly port: number;
  readonly version: string;
  readonly systemRoot: string | undefined;
  // A simulated AllDebrid for this run (engine/launch-options.ts); the engine refuses one that
  // is not on this computer.
  readonly alldebridApi?: string | undefined;
}

// Built from scratch, never from `process.env`: inherited variables silently override
// configuration. `SystemRoot` is the one OS variable kept — Windows networking needs it.
export function buildServerEnv(input: ServerEnvInput): Record<string, string> {
  return {
    SCIA_API_TOKEN: input.apiToken,
    SCIA_PORT: String(input.port),
    SCIA_DATA_DIR: input.layout.dataDir,
    SCIA_DOWNLOAD_DIR: input.layout.downloadDir,
    SCIA_STATIC_DIR: input.layout.rendererDir,
    SCIA_VERSION: input.version,
    ...(input.alldebridApi === undefined ? {} : { SCIA_ALLDEBRID_API: input.alldebridApi }),
    ...(input.layout.ytDlp === undefined ? {} : { SCIA_YT_DLP: input.layout.ytDlp }),
    ...(input.systemRoot === undefined ? {} : { SystemRoot: input.systemRoot }),
  };
}
