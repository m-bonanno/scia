import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { AllDebrid } from './alldebrid.ts';
import { createApp } from './app.ts';
import { parseConfig, type ServerConfig } from './config.ts';
import { DownloadManager } from './download-manager.ts';
import { HttpSource } from './http-source.ts';
import { Integrations } from './integrations.ts';
import { MemoryVault, ParentVault } from './key-vault.ts';
import { createJsonLogger, describeFailure, type Logger } from './logger.ts';
import { signingKeyOf } from './openpgp.ts';
import type { PageReader } from './page-reader.ts';
import { parentPort } from './parent-port.ts';
import { JsonStateStore } from './state-store.ts';
import { YtDlp } from './yt-dlp.ts';
import { YtDlpReleases } from './yt-dlp-releases.ts';
import { YT_DLP_SIGNING_KEY } from './yt-dlp-signing-key.ts';
import { openYtDlpUpdates, type YtDlpUpdates } from './yt-dlp-updates.ts';

// The engine tells main where it listens; main tells it to stop before quitting.
export interface ReadyMessage {
  readonly type: 'ready';
  readonly port: number;
}
export interface ShutdownMessage {
  readonly type: 'shutdown';
}

async function extensionTokenIn(dataDir: string): Promise<string> {
  const path = join(dataDir, 'extension-token');
  try {
    const stored = (await readFile(path, 'utf8')).trim();
    if (/^[0-9a-f]{64}$/.test(stored)) return stored;
  } catch {
    // First start, or a file nobody can read: a new token, and the extension is paired again.
  }
  const token = randomBytes(32).toString('hex');
  await writeFile(path, token, { mode: 0o600 });
  return token;
}

// A read of a page that has not ended in this long is given up, however much yt-dlp said: it
// waits up to 30 s on a silent site itself (`--socket-timeout`), and may ask a site several times.
const PAGE_READ_LIMIT_MS = 90_000;

// A yt-dlp that is named and missing reads no page: pages are fetched as they stand, as without
// one, rather than every page failing for a program that is not there. One that main says the
// release of is brought up to date (docs/adr/0011), and each read runs the build in use then.
async function pageReaderOf(
  config: Pick<
    ServerConfig,
    'ytDlp' | 'ytDlpUpdates' | 'ytDlpReleases' | 'tempDir' | 'dataDir' | 'version'
  >,
  logger: Logger,
): Promise<{ pageReader?: PageReader; updates?: YtDlpUpdates }> {
  const shipped = config.ytDlp;
  if (shipped === undefined) return {};
  if (!existsSync(shipped)) {
    logger.warn('page_reader_missing', {});
    return {};
  }
  const updates =
    config.ytDlpUpdates === undefined
      ? undefined
      : await openYtDlpUpdates({
          shipped: { path: shipped, version: config.ytDlpUpdates.version },
          asset: config.ytDlpUpdates.asset,
          folder: join(config.dataDir, 'yt-dlp'),
          releases: new YtDlpReleases({
            address: config.ytDlpReleases,
            userAgent: `Scia/${config.version}`,
          }),
          signingKey: signingKeyOf(YT_DLP_SIGNING_KEY),
          logger,
        });
  const pageReader = new YtDlp({
    command: () => updates?.command() ?? shipped,
    timeoutMs: PAGE_READ_LIMIT_MS,
    tempDir: config.tempDir,
  });
  return updates === undefined ? { pageReader } : { pageReader, updates };
}

export async function main(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  const logger = createJsonLogger(console.log);
  const config = parseConfig(env);
  await mkdir(config.dataDir, { recursive: true });

  // Main keeps the keys of the services, where the system protects them. Under plain Node
  // there is no main: a key lasts as long as this process, and is written nowhere.
  const keeper = parentPort();
  const integrations = await Integrations.open({
    vault: keeper === undefined ? new MemoryVault() : new ParentVault(keeper),
    alldebrid: new AllDebrid({ api: config.alldebridApi, userAgent: `Scia/${config.version}` }),
    logger,
    hostsFile: join(config.dataDir, 'alldebrid-hosts.json'),
  });

  const { pageReader, updates } = await pageReaderOf(config, logger);
  const source = new HttpSource(`Mozilla/5.0 (compatible; Scia/${config.version})`);
  const manager = await DownloadManager.open({
    source,
    store: new JsonStateStore(join(config.dataDir, 'state.json')),
    defaultDirectory: config.downloadDir,
    logger,
    resolver: integrations,
    magnets: integrations,
    ...(pageReader === undefined ? {} : { pageReader }),
  });

  let port = config.port;
  const app = createApp({
    manager,
    integrations,
    apiToken: config.apiToken,
    extensionToken: await extensionTokenIn(config.dataDir),
    version: config.version,
    port: () => port,
    staticDir: config.staticDir,
    logger,
  });

  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: config.port }, (info) => {
    port = info.port;
    logger.info('listening', { port, version: config.version, node: process.versions.node });
    parentPort()?.postMessage({ type: 'ready', port } satisfies ReadyMessage);
    // Once the engine answers: nothing in its start waits on yt-dlp's releases.
    updates?.start(manager);
  });
  server.on('error', (error) => {
    logger.error('listen_failed', { port: config.port, error: describeFailure(error) });
    process.exit(1);
  });

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    void Promise.all([manager.close(), updates?.close()])
      .catch((error: unknown) => {
        logger.error('shutdown_failed', { error: describeFailure(error) });
      })
      .finally(() => {
        source.close();
        server.close();
        logger.info('stopped');
        process.exit(0);
      });
  };
  parentPort()?.on('message', (event) => {
    if ((event.data as Partial<ShutdownMessage> | null)?.type === 'shutdown') shutdown();
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
