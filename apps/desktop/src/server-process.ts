import { utilityProcess } from 'electron';
import type { ReadyMessage, ShutdownMessage } from '@scia/server';
import type { StartedServer } from './engine/server-supervisor.ts';

// Never tuned against a warm start: the first launch after an install is slow (the antivirus
// scans the new files).
const READY_LIMIT_MS = 60_000;
// An engine that does not stop when asked is stopped.
const STOP_LIMIT_MS = 5000;

export interface ServerLog {
  info(message: string): void;
  warn(message: string): void;
}

export interface StartServerOptions {
  readonly entry: string;
  readonly env: Record<string, string>;
  readonly log: ServerLog;
  // What main answers to a message of the engine's that asks something of it — today, the key
  // of a service (engine/key-vault.ts). Undefined for a message that asks nothing; it never
  // rejects.
  readonly answer: (message: unknown) => Promise<unknown>;
}

function isReadyMessage(message: unknown): message is ReadyMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as Partial<ReadyMessage>).type === 'ready' &&
    typeof (message as Partial<ReadyMessage>).port === 'number'
  );
}

export async function startServer(options: StartServerOptions): Promise<StartedServer> {
  const child = utilityProcess.fork(options.entry, [], {
    env: options.env,
    stdio: 'pipe',
    serviceName: 'Scia engine',
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    options.log.info(`[engine] ${chunk.toString().trimEnd()}`);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    options.log.warn(`[engine] ${chunk.toString().trimEnd()}`);
  });
  // From its first moment: the engine asks for its keys before it listens.
  child.on('message', (message: unknown) => {
    void options.answer(message).then((answer) => {
      if (answer !== undefined) child.postMessage(answer);
    });
  });
  let hasExited = false;
  const exited = new Promise<number>((resolve) => {
    child.once('exit', (code) => {
      hasExited = true;
      resolve(code);
    });
  });

  const port = await new Promise<number>((resolve, reject) => {
    const limit = setTimeout(() => {
      child.kill();
      reject(new Error(`The engine was not ready after ${String(READY_LIMIT_MS)} ms.`));
    }, READY_LIMIT_MS);
    child.on('message', (message: unknown) => {
      if (!isReadyMessage(message)) return;
      clearTimeout(limit);
      resolve(message.port);
    });
    void exited.then((code) => {
      clearTimeout(limit);
      reject(new Error(`The engine exited during startup with code ${String(code)}.`));
    });
  });

  return {
    port,
    exited,
    stop: async () => {
      if (hasExited) return;
      const limit = setTimeout(() => {
        child.kill();
      }, STOP_LIMIT_MS);
      child.postMessage({ type: 'shutdown' } satisfies ShutdownMessage);
      await exited;
      clearTimeout(limit);
    },
  };
}
