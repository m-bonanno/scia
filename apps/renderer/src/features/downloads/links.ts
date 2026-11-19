const LINK = /https?:\/\/[^\s<>"'`]+/gi;
// Punctuation that ends a sentence around a link, not the link.
const TRAILING = /[.,;:!?)\]}]+$/;

// Every http(s) address in a pasted text, once each, in the order they appear.
export function extractLinks(text: string): string[] {
  const links = new Set<string>();
  for (const match of text.matchAll(LINK)) {
    const link = match[0].replace(TRAILING, '');
    if (URL.canParse(link)) links.add(link);
  }
  return [...links];
}
