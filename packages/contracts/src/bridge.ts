// The named requests of `window.scia` (apps/desktop/CLAUDE.md). No Zod here: the preload bundles
// this file.
export const BridgeChannel = {
  RevealDownload: 'downloads.reveal',
  OpenDownload: 'downloads.open',
} as const;
export type BridgeChannel = (typeof BridgeChannel)[keyof typeof BridgeChannel];
