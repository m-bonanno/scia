import { type DownloadActivity, unfinished } from './download-activity.ts';

export const CloseOutcome = { Ignored: 'ignored', Hidden: 'hidden', Quit: 'quit' } as const;
export type CloseOutcome = (typeof CloseOutcome)[keyof typeof CloseOutcome];

export type CloseResult =
  | { readonly outcome: typeof CloseOutcome.Ignored | typeof CloseOutcome.Quit }
  | { readonly outcome: typeof CloseOutcome.Hidden; readonly activity: DownloadActivity };

export interface CloseRequest {
  // A tray icon exists to bring the window back.
  readonly trayAvailable: boolean;
  // The app is already quitting: a close is part of it, there is nothing to decide.
  readonly quitting: () => boolean;
  // The window is on screen: asked after the engine answered, when the person may have brought
  // it back.
  readonly visible: () => boolean;
  readonly hide: () => void;
  readonly quit: () => void;
  // Rejects when the engine does not answer in time.
  readonly activity: () => Promise<DownloadActivity>;
}

// What closing the window means. It goes at once, whatever is decided next: an X that waits for
// an answer is an X that does nothing. Then Scia stays, out of sight, only while it has work to
// finish and a way back: a window hidden with no tray would be an app nobody can reach or quit.
export class WindowCloser {
  readonly #request: CloseRequest;
  #deciding = false;

  constructor(request: CloseRequest) {
    this.#request = request;
  }

  // The window hides at every close: an X always does something, also on a window brought
  // back while an earlier close is still being decided. The decision is one at a time: that
  // second close asks nothing again, and tells nobody anything twice.
  async close(): Promise<CloseResult> {
    if (this.#request.quitting()) return { outcome: CloseOutcome.Ignored };
    this.#request.hide();
    if (this.#deciding) return { outcome: CloseOutcome.Ignored };
    this.#deciding = true;
    try {
      return await this.#decide();
    } finally {
      this.#deciding = false;
    }
  }

  async #decide(): Promise<CloseResult> {
    const request = this.#request;
    if (!request.trayAvailable) {
      request.quit();
      return { outcome: CloseOutcome.Quit };
    }
    const activity = await request.activity().catch(() => undefined);
    // What happened meanwhile has the last word: a quit asked from the tray or by the system,
    // or the person opening the window again — nobody quits, or is told Scia went to the tray,
    // in front of an open window.
    if (request.quitting() || request.visible()) return { outcome: CloseOutcome.Ignored };
    // An engine that did not say what it is doing is not worth staying for.
    if (activity === undefined || unfinished(activity) === 0) {
      request.quit();
      return { outcome: CloseOutcome.Quit };
    }
    return { outcome: CloseOutcome.Hidden, activity };
  }
}
