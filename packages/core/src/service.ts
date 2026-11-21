// Why a service Scia is connected to did not do what it was asked. The person reads the text
// the renderer maps the code to.
export const ServiceFailure = {
  // The service does not know the key, or no longer accepts it.
  KeyRefused: 'KEY_REFUSED',
  // The service refuses the key from this network or this country.
  KeyBlocked: 'KEY_BLOCKED',
  AccountBanned: 'ACCOUNT_BANNED',
  // The service does not serve the network Scia is on: a server, some VPNs.
  NetworkRefused: 'NETWORK_REFUSED',
  // It did not answer, or said it cannot right now, or said something Scia does not understand.
  Unavailable: 'SERVICE_UNAVAILABLE',
} as const;
export type ServiceFailure = (typeof ServiceFailure)[keyof typeof ServiceFailure];

// Why a service did not unlock a link it was given, when it is not one of the above.
export const UnlockFailure = {
  // The service unlocks this link only for an account that pays, or the trial has run out.
  NotPremium: 'NOT_PREMIUM',
  // The file is no longer on its host.
  LinkDown: 'LINK_DOWN',
  // The link asks for a password.
  LinkPassword: 'LINK_PASSWORD',
  // The service cannot reach the link's host right now.
  HostUnavailable: 'HOST_UNAVAILABLE',
  // The account has used what the service allows it of this host, for now.
  HostLimit: 'HOST_LIMIT',
  // The service could not unlock the link, and says no more.
  LinkRefused: 'LINK_REFUSED',
  // The link was a service's when it was added, and that service is no longer connected.
  NotConnected: 'SERVICE_NOT_CONNECTED',
  // The service was still preparing the link after the longest wait Scia gives it.
  NotReady: 'LINK_NOT_READY',
  // A file host's link, added while no service is connected: Scia does not fetch the host's page
  // and call it the file (#49).
  NeedsService: 'SERVICE_NEEDED',
} as const;
export type UnlockFailure = (typeof UnlockFailure)[keyof typeof UnlockFailure];

// Why a code to confirm on the service's site gave no key (#136), when it is not one of the
// service's refusals above.
export const CodeFailure = {
  // Its time ran out, or the service no longer knows it: a new code is asked for.
  Expired: 'CODE_EXPIRED',
} as const;
export type CodeFailure = (typeof CodeFailure)[keyof typeof CodeFailure];

// The longest Scia waits for a link the service is still preparing: the owner's decision (#7).
// The engine gives up after it, and the page says how long it waited.
export const PREPARE_LIMIT_SECONDS = 30 * 60;

export function isServiceFailure(value: unknown): value is ServiceFailure {
  return Object.values(ServiceFailure).some((failure) => failure === value);
}
