// The named requests of `window.scia` (apps/desktop/CLAUDE.md). No Zod here: the preload bundles
// this file.
export const BridgeChannel = {
  RevealDownload: 'downloads.reveal',
  OpenDownload: 'downloads.open',
  ChooseDownloadFolder: 'settings.chooseDownloadFolder',
  ThemeChanged: 'settings.themeChanged',
  // The version of an update the next quit would install, or none.
  UpdateOffered: 'updates.offered',
  // Sent by main to the page, with nothing in it: what may be offered changed; the page asks.
  UpdateChanged: 'updates.changed',
  RestartToUpdate: 'updates.restart',
  OpenCodePage: 'integrations.openCodePage',
  OpenSupportPage: 'support.openPage',
} as const;
export type BridgeChannel = (typeof BridgeChannel)[keyof typeof BridgeChannel];

// Where a person can support Scia (#271). The page asks main to open it and names nothing: main
// opens this address alone, in the person's browser.
export const SUPPORT_PAGE = 'https://ko-fi.com/notsosnake';

// What main answers to `chooseDownloadFolder`: what became of the folder. Anything that is not
// about the folder — an engine that fails or is silent — is a rejection, not one of these.
export const FolderChange = {
  Changed: 'changed',
  // The person closed the dialog without choosing.
  Kept: 'kept',
  // The engine cannot make the folder that was chosen, or cannot write to it.
  Refused: 'refused',
} as const;
export type FolderChange = (typeof FolderChange)[keyof typeof FolderChange];

// What main answers to `restartToUpdate`. Main decides, not the page: an update never installs
// while a download runs or waits (docs/adr/0007-automatic-updates.md).
export const UpdateRestart = {
  // Scia quits, installs and starts again.
  Restarting: 'restarting',
  // A download runs or waits, or the engine did not say: the update installs at the next quit.
  Busy: 'busy',
  // No update is offered any more.
  Nothing: 'nothing',
} as const;
export type UpdateRestart = (typeof UpdateRestart)[keyof typeof UpdateRestart];

export function isFolderChange(value: unknown): value is FolderChange {
  return Object.values(FolderChange).some((change) => change === value);
}

// The systems whose releases carry an installer, which is what an installed Scia updates itself
// from (docs/adr/0007-automatic-updates.md): main updates only there, and Settings offers the
// betas only there. Electron's names, as `window.scia.platform` says them.
export const SELF_UPDATING_PLATFORMS = ['win32'] as const;
