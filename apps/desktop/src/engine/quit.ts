// Why Windows ends the session (Electron's `WindowSessionEndEvent`): "close-app" is an installer,
// or the Restart Manager, that needs the app's files.
export type SessionEndReason = 'shutdown' | 'close-app' | 'critical' | 'logoff';

export interface QuitSteps {
  // What would go on, or show something, while Scia quits — main's ear on the engine, the
  // notifications to come, the clipboard, the window, the tray: stopped at once.
  readonly settle: () => void;
  // Whether the quit installs the update downloaded, decided while the engine still runs (it
  // keeps the betas switch).
  readonly installs: (askedByPerson: boolean) => Promise<boolean>;
  // Asks the engine to stop and write its state; resolves once it has, within its own bound.
  readonly stopEngine: () => Promise<void>;
  // The quit's last step once the engine has stopped: starts the installer when the quit installs,
  // and answers whether Scia is owed a start.
  readonly finish: (install: boolean) => boolean;
  readonly relaunch: () => void;
  readonly exit: () => void;
  readonly log: { info(message: string, details?: object): void };
}

// Scia's one way out (apps/desktop/CLAUDE.md, "Quitting never hangs"). A quit asked by the person
// or by Electron decides on the update, stops the engine, and ends; the end of the session —
// which Electron's `before-quit` never hears of — stops the engine at once, installs nothing and
// starts nothing, and does not ask Windows to wait (#13).
export class Quit {
  readonly #steps: QuitSteps;
  #begun = false;
  #sessionEnded = false;
  #stopping: Promise<void> | undefined;

  constructor(steps: QuitSteps) {
    this.#steps = steps;
  }

  begun(): boolean {
    return this.#begun;
  }

  asked(byPerson: boolean): void {
    if (this.#begun) return;
    this.#begun = true;
    this.#steps.settle();
    void this.#steps
      .installs(byPerson)
      .catch(() => false)
      .then(async (install) => {
        await this.#stop();
        // A session that ended meanwhile is owed nothing: an installer started now, or a Scia
        // started again, would meet the system closing it — or the installer that asked.
        if (this.#ended()) {
          if (install) this.#steps.log.info('update_not_installed', { reason: 'session_end' });
          return;
        }
        if (this.#steps.finish(install)) this.#steps.relaunch();
      })
      .finally(() => {
        this.#end();
      });
  }

  sessionEnded(reasons: readonly SessionEndReason[]): void {
    this.#steps.log.info('session_ended', { reasons, quitting: this.#begun });
    this.#sessionEnded = true;
    if (this.#begun) {
      // The quit under way — or the end of the session told before — ends once this same stop
      // has.
      void this.#stop();
      return;
    }
    this.#begun = true;
    this.#steps.settle();
    const stopped = this.#stop();
    // Asked only to stop the updater: what it answers is not waited for.
    void this.#steps.installs(false).catch(() => false);
    void stopped.finally(() => {
      this.#end();
    });
  }

  // Read anew after every wait: the session may have ended meanwhile.
  #ended(): boolean {
    return this.#sessionEnded;
  }

  #stop(): Promise<void> {
    this.#stopping ??= this.#steps.stopEngine();
    return this.#stopping;
  }

  #end(): void {
    this.#steps.log.info('quit');
    this.#steps.exit();
  }
}
