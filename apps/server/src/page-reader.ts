import type { PageFormat } from './media-choice.ts';

// What a reader of sites found in a page.
export interface PageMedia {
  // What the site calls the video: a name from a host, as hostile as any.
  readonly title: string | undefined;
  readonly formats: readonly PageFormat[];
}

// The PORT a reader of sites plugs into (docs/adr/0009): a step after the host said a link is a
// page, which finds the video the page plays. `YtDlp` is its adapter; a manager with no reader
// fetches every page as it stands.
export interface PageReader {
  // The video of the page; undefined when the page is not of a site the reader knows, which is
  // then fetched as it stands. Rejects with a PageError that says why not, or with the reason of
  // `signal`.
  read(url: string, signal: AbortSignal): Promise<PageMedia | undefined>;
}
