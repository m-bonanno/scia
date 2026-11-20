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
