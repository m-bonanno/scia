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
  // Scia answered, and does not know the code.
  WrongCode: 'wrong-code',
  // Nothing to send that Scia can fetch: it takes http and https addresses.
  Unsupported: 'unsupported',
  // Scia answered, and refused for a reason that is not the code.
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

function answered(response: Response): SendOutcome {
  if (response.ok) return SendOutcome.Sent;
  return response.status === 401 ? SendOutcome.WrongCode : SendOutcome.Refused;
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
  if (links.length === 0) return SendOutcome.Unsupported;
  try {
    const response = await fetchFn(`${origin(pairing.port)}${API_PREFIX}/downloads`, {
      method: 'POST',
      headers: authorized(pairing),
      body: JSON.stringify({ urls: links, ...(isHttp(referrer) ? { referrer } : {}) }),
    });
    return answered(response);
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
    return answered(response);
  } catch {
    return SendOutcome.Unreachable;
  }
}

export const OUTCOME_TEXT: Readonly<Record<SendOutcome, string>> = {
  sent: 'Sent to Scia.',
  'not-paired': 'Pair the extension with Scia first.',
  unreachable: 'Scia is not running. Open it and try again.',
  'wrong-code': 'Scia does not recognize the code. Pair the extension again.',
  unsupported: 'Scia downloads http and https links only.',
  refused: 'Scia refused the request.',
};

// Whether the way out is the options page, where the code is pasted.
export function needsPairing(outcome: SendOutcome): boolean {
  return outcome === SendOutcome.NotPaired || outcome === SendOutcome.WrongCode;
}
