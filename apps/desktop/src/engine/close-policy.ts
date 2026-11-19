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
