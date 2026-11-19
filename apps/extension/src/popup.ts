import type { MediaItem } from './media.ts';
import { checkPairing, OUTCOME_TEXT, SendOutcome, sendToScia } from './scia-client.ts';
import { loadSettings, mediaOfTab } from './storage.ts';

const KIND_LABEL: Readonly<Record<MediaItem['kind'], string>> = { video: 'Video', audio: 'Audio' };

function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) throw new Error(`popup.html is missing #${id}`);
  return found;
}

function megabytes(bytes: number): string {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`;
}

const status = element('status', HTMLParagraphElement);
const list = element('media', HTMLUListElement);
const all = element('all', HTMLButtonElement);
const pair = element('pair', HTMLButtonElement);

function say(text: string, problem = false): void {
  status.textContent = text;
  status.className = problem ? 'problem' : 'muted';
}

async function start(): Promise<void> {
  const settings = await loadSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const media = tab?.id === undefined ? [] : await mediaOfTab(tab.id);

  const send = async (items: readonly MediaItem[], button: HTMLButtonElement): Promise<void> => {
    button.disabled = true;
    const outcome = await sendToScia(
      settings,
      items.map((item) => item.url),
      tab?.url,
    );
    say(OUTCOME_TEXT[outcome], outcome !== SendOutcome.Sent);
    button.disabled = outcome === SendOutcome.Sent;
  };

  pair.addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });

  const pairing = await checkPairing(settings);
  if (pairing !== SendOutcome.Sent) {
    say(OUTCOME_TEXT[pairing], true);
    pair.hidden = pairing === SendOutcome.Unreachable;
    return;
  }

  if (media.length === 0) {
    say('No video or audio on this page. For a link, right-click it: “Download with Scia”.');
    return;
  }
  say(media.length === 1 ? '1 file on this page' : `${String(media.length)} files on this page`);

  // Latest first: what just started playing is what the person came for.
  for (const item of media.toReversed()) {
    const row = document.createElement('li');
    const text = document.createElement('div');
    text.className = 'text';
    const name = document.createElement('p');
    name.className = 'name';
    name.textContent = item.fileName;
    name.title = item.fileName;
    const details = document.createElement('p');
    details.className = 'muted';
    details.textContent =
      item.size === null
        ? KIND_LABEL[item.kind]
        : `${KIND_LABEL[item.kind]} · ${megabytes(item.size)}`;
    text.append(name, details);
    const button = document.createElement('button');
    button.textContent = 'Download';
    button.addEventListener('click', () => {
      void send([item], button);
    });
    row.append(text, button);
    list.append(row);
  }

  all.hidden = media.length < 2;
  all.addEventListener('click', () => {
    void send(media, all);
  });
}

void start();
