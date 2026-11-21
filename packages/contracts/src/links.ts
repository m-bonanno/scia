import { z } from 'zod';

// An address the engine takes: http or https, nothing else.
export const httpUrl = z.url({ protocol: /^https?$/ });

const LINK = /https?:\/\/[^\s<>"'`]+/gi;
// Punctuation that ends a sentence around a link, not the link.
const TRAILING = /[.,;:!?)\]}]+$/;

// Every http(s) address in a text — pasted in the page, or copied and read by main — once each,
// in the order they appear, each one the engine takes.
export function extractLinks(text: string): string[] {
  const links = new Set<string>();
  // A magnet's trackers are its own, never links of their own.
  for (const match of text.replace(MAGNET_IN_TEXT, ' ').matchAll(LINK)) {
    const link = match[0].replace(TRAILING, '');
    if (httpUrl.safeParse(link).success) links.add(link);
  }
  return [...links];
}

// A magnet Scia can hand to a service (#137): the hash of its torrent — 40 hexadecimal digits, or
// 32 of base 32 — among its parameters, and nothing that is not part of a link. Long enough for
// many trackers, not for a text.
const MAGNET = /^magnet:\?(?:[^\s&]*&)*xt=urn:btih:(?:[0-9a-f]{40}|[a-z2-7]{32})(?:&\S*)?$/i;
export const MAX_MAGNET_LENGTH = 8192;
export const magnetUri = z.string().max(MAX_MAGNET_LENGTH).regex(MAGNET);

const MAGNET_IN_TEXT = /magnet:\?[^\s<>"'`]+/gi;

// Every magnet in a pasted text, once each, in the order they appear. Only the page takes them:
// what main reads on the clipboard is extractLinks' (#139 is to change that).
export function extractMagnets(text: string): string[] {
  const magnets = new Set<string>();
  for (const match of text.matchAll(MAGNET_IN_TEXT)) {
    const magnet = match[0].replace(TRAILING, '');
    if (magnetUri.safeParse(magnet).success) magnets.add(magnet);
  }
  return [...magnets];
}
