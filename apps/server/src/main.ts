import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { parseConfig } from './config.ts';
import { DownloadManager } from './download-manager.ts';
import { HttpSource } from './http-source.ts';
import { createJsonLogger, describeFailure } from './logger.ts';
import { JsonStateStore } from './state-store.ts';

// The engine tells main where it listens; main tells it to stop before quitting.
export interface ReadyMessage {
  readonly type: 'ready';
  readonly port: number;
}
export interface ShutdownMessage {
  readonly type: 'shutdown';
}

// Electron's channel to the process that forked this one; absent under plain Node.
interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { readonly data: unknown }) => void): void;
}

function parentPort(): ParentPort | undefined {
  return (process as { parentPort?: ParentPort }).parentPort;
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

export async function main(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  const logger = createJsonLogger(console.log);
  const config = parseConfig(env);
  await mkdir(config.dataDir, { recursive: true });

  const source = new HttpSource(`Mozilla/5.0 (compatible; Scia/${config.version})`);
  const manager = await DownloadManager.open({
    source,
    store: new JsonStateStore(join(config.dataDir, 'state.json')),
    defaultDirectory: config.downloadDir,
    logger,
  });

  let port = config.port;
  const app = createApp({
    manager,
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
  });
  server.on('error', (error) => {
    logger.error('listen_failed', { port: config.port, error: describeFailure(error) });
    process.exit(1);
  });

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    void manager
      .close()
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
