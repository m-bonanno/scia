import { type DownloadActivity, unfinished } from './download-activity.ts';

export const CloseAction = { Hide: 'hide', Quit: 'quit' } as const;
export type CloseAction = (typeof CloseAction)[keyof typeof CloseAction];

export interface CloseContext {
  // A tray icon exists to bring the window back.
  readonly trayAvailable: boolean;
  // Downloads running or waiting their turn; undefined when the engine did not answer.
  readonly unfinished: number | undefined;
}

// What closing the window means. Scia stays, out of sight, only while it has work to finish and
// a way back: a window hidden with no tray would be an app nobody can reach or quit.
export function closeAction(context: CloseContext): CloseAction {
  return context.trayAvailable && context.unfinished !== undefined && context.unfinished > 0
    ? CloseAction.Hide
    : CloseAction.Quit;
}

export const CloseOutcome = { Ignored: 'ignored', Hidden: 'hidden', Quit: 'quit' } as const;
export type CloseOutcome = (typeof CloseOutcome)[keyof typeof CloseOutcome];

export type CloseResult =
  | { readonly outcome: typeof CloseOutcome.Ignored | typeof CloseOutcome.Quit }
  | { readonly outcome: typeof CloseOutcome.Hidden; readonly activity: DownloadActivity };

export interface CloseRequest {
  readonly trayAvailable: boolean;
  // The app is already quitting: a close is part of it, there is nothing to decide.
  readonly quitting: () => boolean;
  readonly hide: () => void;
  readonly quit: () => void;
  // Rejects when the engine does not answer in time.
  readonly activity: () => Promise<DownloadActivity>;
}

// The person closed the window. It goes at once, whatever is decided next: an X that waits for
// an answer is an X that does nothing. Then Scia stays hidden or quits.
export class WindowCloser {
  readonly #request: CloseRequest;
  #deciding = false;

  constructor(request: CloseRequest) {
    this.#request = request;
  }

  // One decision at a time: a close that arrives while the engine is being asked changes
  // nothing, and tells nobody anything twice.
  async close(): Promise<CloseResult> {
    if (this.#deciding || this.#request.quitting()) return { outcome: CloseOutcome.Ignored };
    this.#deciding = true;
    try {
      return await this.#decide();
    } finally {
      this.#deciding = false;
    }
  }

  async #decide(): Promise<CloseResult> {
    const request = this.#request;
    request.hide();
    if (!request.trayAvailable) {
      request.quit();
      return { outcome: CloseOutcome.Quit };
    }
    const activity = await request.activity().catch(() => undefined);
    // A quit asked for meanwhile (from the tray, by the system) has the last word.
    if (request.quitting()) return { outcome: CloseOutcome.Ignored };
    if (
      activity === undefined ||
      closeAction({ trayAvailable: true, unfinished: unfinished(activity) }) === CloseAction.Quit
    ) {
      request.quit();
      return { outcome: CloseOutcome.Quit };
    }
    return { outcome: CloseOutcome.Hidden, activity };
  }
}
