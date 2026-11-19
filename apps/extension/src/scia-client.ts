import { API_PREFIX } from '@scia/contracts/endpoint';

export interface Pairing {
  readonly token: string;
  readonly port: number;
}

export const SendOutcome = {
  Sent: 'sent',
  // No code saved yet: the person has to pair the extension first.
  NotPaired: 'not-paired',
  // Scia is closed, or listens on another port.
  Unreachable: 'unreachable',
  // Scia answered, and refused the code or the link.
  Refused: 'refused',
} as const;
export type SendOutcome = (typeof SendOutcome)[keyof typeof SendOutcome];

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

function origin(port: number): string {
  return `http://127.0.0.1:${String(port)}`;
}

function isHttp(url: string | undefined): url is string {
  return url !== undefined && /^https?:\/\//i.test(url);
}

function authorized(pairing: Pairing): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${pairing.token}` };
}

// Hands links to the desktop app. The referrer is the page they were on.
export async function sendToScia(
  pairing: Pairing,
  urls: readonly string[],
  referrer: string | undefined,
  fetchFn: Fetch = fetch,
): Promise<SendOutcome> {
  if (pairing.token === '') return SendOutcome.NotPaired;
  const links = urls.filter(isHttp);
  if (links.length === 0) return SendOutcome.Refused;
  try {
    const response = await fetchFn(`${origin(pairing.port)}${API_PREFIX}/downloads`, {
      method: 'POST',
      headers: authorized(pairing),
      body: JSON.stringify({ urls: links, ...(isHttp(referrer) ? { referrer } : {}) }),
    });
    return response.ok ? SendOutcome.Sent : SendOutcome.Refused;
  } catch {
    return SendOutcome.Unreachable;
  }
}

// Whether Scia runs there and takes this code, without adding anything.
export async function checkPairing(pairing: Pairing, fetchFn: Fetch = fetch): Promise<SendOutcome> {
  if (pairing.token === '') return SendOutcome.NotPaired;
  try {
    const response = await fetchFn(`${origin(pairing.port)}${API_PREFIX}/extension/check`, {
      headers: authorized(pairing),
    });
    return response.ok ? SendOutcome.Sent : SendOutcome.Refused;
  } catch {
    return SendOutcome.Unreachable;
  }
}

export const OUTCOME_TEXT: Readonly<Record<SendOutcome, string>> = {
  sent: 'Inviato a Scia.',
  'not-paired': 'Collega prima l’estensione a Scia.',
  unreachable: 'Scia non è in esecuzione. Aprila e riprova.',
  refused: 'Scia ha rifiutato la richiesta. Controlla il codice di collegamento.',
};
