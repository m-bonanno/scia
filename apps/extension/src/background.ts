import { mediaOf } from './media.ts';
import { needsPairing, SendOutcome, sendToScia } from './scia-client.ts';
import { forgetMedia, loadSettings, rememberMedia } from './storage.ts';

const MENU_ID = 'scia-download';
const BADGE_COLOUR = '#202020';
const FEEDBACK_MS = 1500;

async function showCount(tabId: number, count: number): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOUR });
  await chrome.action.setBadgeText({ tabId, text: count === 0 ? '' : String(count) });
}

// The badge says for a moment how a send went, without a notification to dismiss.
async function showOutcome(tabId: number | undefined, outcome: SendOutcome): Promise<void> {
  if (tabId === undefined || tabId < 0) return;
  const before = await chrome.action.getBadgeText({ tabId });
  await chrome.action.setBadgeText({ tabId, text: outcome === SendOutcome.Sent ? '✓' : '!' });
  setTimeout(() => {
    void chrome.action.setBadgeText({ tabId, text: before });
  }, FEEDBACK_MS);
}

async function deliver(
  urls: readonly string[],
  referrer: string | undefined,
  tabId: number | undefined,
): Promise<SendOutcome> {
  const outcome = await sendToScia(await loadSettings(), urls, referrer);
  if (needsPairing(outcome)) await chrome.runtime.openOptionsPage();
  await showOutcome(tabId, outcome);
  return outcome;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Download with Scia',
    contexts: ['link', 'video', 'audio', 'image'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const url = info.linkUrl ?? info.srcUrl;
  if (info.menuItemId !== MENU_ID || url === undefined) return;
  void deliver([url], info.pageUrl, tab?.id);
});

// The media a page loads, seen in the answers it receives. Nothing is changed or held back.
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return undefined;
    const media = mediaOf(details);
    if (media !== undefined) {
      void rememberMedia(details.tabId, media).then((count) => showCount(details.tabId, count));
    }
    return undefined;
  },
  { urls: ['http://*/*', 'https://*/*'], types: ['media', 'xmlhttprequest', 'object', 'other'] },
  ['responseHeaders'],
);

// A new page in the tab: what the old one played is gone.
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId >= 0) void forgetMedia(details.tabId);
    return undefined;
  },
  { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] },
);

chrome.tabs.onRemoved.addListener((tabId) => {
  void forgetMedia(tabId);
});

// The browser's own downloads, when the person asked for them to go to Scia. The browser's
// download is stopped only once Scia has taken the link: a closed Scia loses nothing.
chrome.downloads.onCreated.addListener((item) => {
  void (async () => {
    const settings = await loadSettings();
    if (!settings.interceptDownloads) return;
    const url = item.finalUrl === '' ? item.url : item.finalUrl;
    const outcome = await sendToScia(
      settings,
      [url],
      item.referrer === '' ? undefined : item.referrer,
    );
    if (outcome !== SendOutcome.Sent) return;
    await chrome.downloads.cancel(item.id);
    await chrome.downloads.erase({ id: item.id });
  })();
});
