import { extractLinks, extractMagnets } from '@scia/contracts/links';

// What a text holds that Scia takes: links, and magnets (#137).
export interface Pasted {
  readonly links: string[];
  readonly magnets: string[];
}

export function pastedIn(text: string): Pasted {
  return { links: extractLinks(text), magnets: extractMagnets(text) };
}
