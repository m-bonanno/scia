// The named requests of `window.scia` (apps/desktop/CLAUDE.md). No Zod here: the preload bundles
// this file.
export const BridgeChannel = {
  RevealDownload: 'downloads.reveal',
  OpenDownload: 'downloads.open',
  ChooseDownloadFolder: 'settings.chooseDownloadFolder',
  ThemeChanged: 'settings.themeChanged',
} as const;
export type BridgeChannel = (typeof BridgeChannel)[keyof typeof BridgeChannel];

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

export function isFolderChange(value: unknown): value is FolderChange {
  return Object.values(FolderChange).some((change) => change === value);
}

// The systems whose releases carry an installer, which is what an installed Scia updates itself
// from (docs/adr/0007-automatic-updates.md): main updates only there, and Settings offers the
// betas only there. Electron's names, as `window.scia.platform` says them.
export const SELF_UPDATING_PLATFORMS = ['win32'] as const;
