import { DEFAULT_API_PORT } from '@scia/contracts/endpoint';
import { type MediaItem, withMedia } from './media.ts';
import type { Pairing } from './scia-client.ts';

export interface ExtensionSettings extends Pairing {
  // Off until the person asks: Scia does not receive the browser's session, so a file behind
  // a login would fail there and never start here.
  readonly interceptDownloads: boolean;
}

const DEFAULTS: ExtensionSettings = {
  token: '',
  port: DEFAULT_API_PORT,
  interceptDownloads: false,
};

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(['token', 'port', 'interceptDownloads']);
  return {
    token: typeof stored.token === 'string' ? stored.token : DEFAULTS.token,
    port: typeof stored.port === 'number' ? stored.port : DEFAULTS.port,
    interceptDownloads:
      typeof stored.interceptDownloads === 'boolean'
        ? stored.interceptDownloads
        : DEFAULTS.interceptDownloads,
  };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ ...settings });
}

// The media of a tab live as long as the browser session: the service worker is stopped and
// started again at the browser's will, and would forget them.
function mediaKey(tabId: number): string {
  return `media:${String(tabId)}`;
}

function isMediaList(value: unknown): value is MediaItem[] {
  return Array.isArray(value);
}

export async function mediaOfTab(tabId: number): Promise<MediaItem[]> {
  const key = mediaKey(tabId);
  const stored = (await chrome.storage.session.get(key))[key];
  return isMediaList(stored) ? stored : [];
}

// Reads and writes of the same list never interleave within one life of the worker.
let writes: Promise<unknown> = Promise.resolve();

export function rememberMedia(tabId: number, item: MediaItem): Promise<number> {
  const write = writes.then(async () => {
    const list = withMedia(await mediaOfTab(tabId), item);
    await chrome.storage.session.set({ [mediaKey(tabId)]: list });
    return list.length;
  });
  writes = write.catch(() => undefined);
  return write;
}

export function forgetMedia(tabId: number): Promise<void> {
  const write = writes.then(() => chrome.storage.session.remove(mediaKey(tabId)));
  writes = write.catch(() => undefined);
  return write;
}
