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
  for (const match of text.matchAll(LINK)) {
    const link = match[0].replace(TRAILING, '');
    if (httpUrl.safeParse(link).success) links.add(link);
  }
  return [...links];
}
