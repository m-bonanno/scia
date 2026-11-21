// What the desktop shell gives the page beyond HTTP. Fields are required so a half-wired bridge
// does not compile. `window.scia` is absent in a plain browser during development, where the
// Vite proxy adds the dev token instead.
export interface SciaBridge {
  readonly apiToken: string;
  readonly version: string;
  readonly platform: string;
  // Main asks the engine where the file is: the page never sends a path.
  revealDownload(id: string): Promise<unknown>;
  openDownload(id: string): Promise<unknown>;
  // Main shows the system's folder dialog and tells the engine: the page sends no path.
  chooseDownloadFolder(): Promise<unknown>;
  // The window's own colours are main's: the page says that the theme changed, and main asks
  // the engine which it is.
  themeChanged(): Promise<unknown>;
  // Main asks the engine for the page where the code it gave is confirmed, and opens it in the
  // person's browser: the page names the service, never an address.
  openCodePage(id: string): Promise<unknown>;
}

declare global {
  interface Window {
    scia?: SciaBridge;
  }
}

export function bridge(): SciaBridge | undefined {
  return window.scia;
}
