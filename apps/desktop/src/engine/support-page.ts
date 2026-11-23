import { SUPPORT_PAGE } from '@scia/contracts/bridge';

// The answer to the page's ask for the support page (#271). The ask comes from the renderer, and
// nothing that comes with it is read: main opens the fixed address, never one from the page.
export function supportPageOpener(
  open: (url: string) => Promise<void>,
): (...given: unknown[]) => Promise<void> {
  return () => open(new URL(SUPPORT_PAGE).href);
}
