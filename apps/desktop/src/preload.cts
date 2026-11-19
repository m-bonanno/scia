// Must stay CommonJS (hence `require`): an ESM preload is silently not loaded under `sandbox: true`.
// Mirrors `SciaBridge` in apps/renderer/src/lib/bridge.ts — change both together.
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');
const { BridgeChannel } =
  require('@scia/contracts/bridge') as typeof import('@scia/contracts/bridge');

function argument(name: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? '';
}

contextBridge.exposeInMainWorld(
  'scia',
  Object.freeze({
    apiToken: argument('scia-api-token'),
    version: argument('scia-version'),
    platform: process.platform,
    // The page names a download; main asks the engine where its file is.
    revealDownload: (id: string) =>
      ipcRenderer.invoke(BridgeChannel.RevealDownload, id) as Promise<unknown>,
    openDownload: (id: string) =>
      ipcRenderer.invoke(BridgeChannel.OpenDownload, id) as Promise<unknown>,
    // The page asks and names nothing: main shows the system's folder dialog.
    chooseDownloadFolder: () =>
      ipcRenderer.invoke(BridgeChannel.ChooseDownloadFolder) as Promise<unknown>,
  }),
);
