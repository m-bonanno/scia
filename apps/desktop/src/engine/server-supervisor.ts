import type { RestartPolicy } from './restart-policy.ts';

export interface StartedServer {
  readonly port: number;
  // Resolves with the exit code when the process ends, however it ends.
  readonly exited: Promise<number>;
  // Asks the engine to stop and resolves once it has.
  stop(): Promise<void>;
}

export interface SupervisorOptions {
  readonly start: () => Promise<StartedServer>;
  readonly policy: RestartPolicy;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  // The engine is back, perhaps on another port: the window follows it.
  readonly onRestarted: (port: number) => void;
  readonly onGaveUp: () => void;
  readonly log: { warn(message: string, details: object): void };
}

// Keeps one engine process alive: starts it again when it exits by itself, with a growing
// wait, and says when that stops being worth trying.
export class ServerSupervisor {
  readonly #options: SupervisorOptions;
  #current: StartedServer | undefined;
  #stopping = false;

  constructor(options: SupervisorOptions) {
    this.#options = options;
  }

  // The first start: its failure is the caller's to show.
  async start(): Promise<number> {
    const server = await this.#options.start();
    await this.#adopt(server);
    return server.port;
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    await this.#current?.stop();
  }

  // Read anew after every wait: stop() may have been called meanwhile.
  #isStopping(): boolean {
    return this.#stopping;
  }

  // An engine that finished starting after stop() was asked is stopped, not watched: stop() had
  // nothing to stop when it ran, and nobody else would.
  async #adopt(server: StartedServer): Promise<boolean> {
    if (this.#isStopping()) {
      await server.stop();
      return false;
    }
    this.#current = server;
    const startedAt = this.#options.now();
    void server.exited.then((code) => this.#restartAfter(code, this.#options.now() - startedAt));
    return true;
  }

  async #restartAfter(code: number, ranForMs: number): Promise<void> {
    if (this.#isStopping()) return;
    this.#current = undefined;
    this.#options.log.warn('engine_exited', { code, ranForMs });
    let lastRunMs = ranForMs;
    for (;;) {
      const delayMs = this.#options.policy.next(lastRunMs);
      if (delayMs === null) {
        this.#options.onGaveUp();
        return;
      }
      await this.#options.sleep(delayMs);
      if (this.#isStopping()) return;
      try {
        const server = await this.#options.start();
        if (await this.#adopt(server)) this.#options.onRestarted(server.port);
        return;
      } catch (error) {
        this.#options.log.warn('engine_restart_failed', { error: String(error) });
        lastRunMs = 0;
      }
    }
  }
}
