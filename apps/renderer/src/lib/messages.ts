import { ApiErrorCode, type IntegrationId } from '@scia/contracts';
import { ServiceFailure, UnlockFailure } from '@scia/core';
import { ApiError } from './api.ts';

// Errors: the fact, then the remedy. No blame, no "Oops".
const BY_CODE: Readonly<Record<string, string>> = {
  [ApiErrorCode.InvalidRequest]: 'No http or https links in what you pasted.',
  [ApiErrorCode.NotFound]: 'This download is no longer in the list.',
  [ApiErrorCode.Conflict]: 'The download has already changed state. Try again in a moment.',
  [ApiErrorCode.Unauthorized]:
    'Scia does not recognize this window. Close the app and open it again.',
};

export const ENGINE_UNREACHABLE = 'Scia’s engine is not responding. Trying again…';

// Main says only that it failed. The engine being silent is the rare cause; a file that is no
// longer where it was downloaded is the common one.
export const FILE_NOT_OPENED = 'Scia could not open the file. It may have been moved or deleted.';

// Said only when main answers that the engine refused the folder the person chose: one it
// cannot make, or cannot write to. Any other failure of that ask is not about a folder.
export const FOLDER_REFUSED =
  'Scia could not use the folder you chose. Choose one it can write to.';

// What each service is called, wherever it is named.
export const SERVICE_NAME: Readonly<Record<IntegrationId, string>> = { alldebrid: 'AllDebrid' };

// Said by the field a key was typed in, each for the one answer it names. Any other failure
// of that attempt is not about the key, and is told as any failure is.
const KEY_NOT_TAKEN: Readonly<Record<string, (service: string) => string>> = {
  [ApiErrorCode.KeyRefused]: (service) =>
    `${service} does not know this key. Copy it again from your ${service} account.`,
  [ApiErrorCode.KeyBlocked]: (service) =>
    `${service} refuses this key from this network. Check your ${service} account, then try again.`,
  [ApiErrorCode.AccountBanned]: (service) => `${service} says this account is banned.`,
  [ApiErrorCode.NetworkRefused]: (service) =>
    `${service} does not serve this network: it refuses servers and some VPNs.`,
  [ApiErrorCode.Unavailable]: (service) => `${service} is not answering. Try again in a moment.`,
  [ApiErrorCode.KeyNotKept]: () =>
    'Scia could not store the key safely on this computer. Nothing was connected.',
  [ApiErrorCode.InvalidRequest]: (service) =>
    `That is not a key. Copy it again from your ${service} account.`,
};

export function connectFailureMessage(error: unknown, id: IntegrationId): string {
  const text = error instanceof ApiError ? KEY_NOT_TAKEN[error.code] : undefined;
  return text === undefined ? errorMessage(error) : text(SERVICE_NAME[id]);
}

// Said of a service that is connected, when it last answered with a refusal or not at all.
const SERVICE_TROUBLE: Readonly<Record<ServiceFailure, (service: string) => string>> = {
  [ServiceFailure.KeyRefused]: (service) =>
    `${service} no longer accepts the key. Disconnect, then connect with a new one.`,
  [ServiceFailure.KeyBlocked]: (service) =>
    `${service} refuses the key from this network. Check your ${service} account.`,
  [ServiceFailure.AccountBanned]: (service) => `${service} says this account is banned.`,
  [ServiceFailure.NetworkRefused]: (service) =>
    `${service} does not serve this network: it refuses servers and some VPNs.`,
  [ServiceFailure.Unavailable]: (service) => `${service} is not answering right now.`,
};

export function serviceTroubleMessage(failure: ServiceFailure, id: IntegrationId): string {
  return SERVICE_TROUBLE[failure](SERVICE_NAME[id]);
}

// Said on the row of a download whose link goes through a service, when the service did not
// give a link for it. Every sentence begins with who said so.
const LINK_NOT_UNLOCKED: Readonly<
  Record<ServiceFailure | UnlockFailure, (service: string) => string>
> = {
  [ServiceFailure.KeyRefused]: (service) =>
    `${service} no longer accepts the key. Connect it again in Settings, then retry.`,
  [ServiceFailure.KeyBlocked]: (service) =>
    `${service} refuses the key from this network. Check your account with it, then retry.`,
  [ServiceFailure.AccountBanned]: (service) => `${service} says the account is banned.`,
  [ServiceFailure.NetworkRefused]: (service) =>
    `${service} does not serve this network: it refuses servers and some VPNs.`,
  [ServiceFailure.Unavailable]: (service) => `${service} is not answering. Try again in a moment.`,
  [UnlockFailure.NotPremium]: (service) =>
    `${service} unlocks this link for premium accounts only.`,
  [UnlockFailure.LinkDown]: (service) => `${service} says the file is no longer on its host.`,
  [UnlockFailure.LinkPassword]: (service) =>
    `${service} says the link asks for a password, which Scia cannot give yet.`,
  [UnlockFailure.HostUnavailable]: (service) =>
    `${service} cannot reach this host right now. Try again later.`,
  [UnlockFailure.HostLimit]: (service) =>
    `${service} says the account has reached its limit for this host. Try again later.`,
  [UnlockFailure.LinkRefused]: (service) => `${service} could not unlock this link.`,
  [UnlockFailure.NotConnected]: (service) =>
    `${service} is no longer connected. Connect it in Settings, then retry.`,
};

// `via` is null when the service failed before it could say whether the link is one of its
// own: the link belongs to no service yet, and the one that did not answer is not named.
export function linkNotUnlockedMessage(
  failure: ServiceFailure | UnlockFailure,
  via: IntegrationId | null,
): string {
  return LINK_NOT_UNLOCKED[failure](via === null ? 'The connected service' : SERVICE_NAME[via]);
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return BY_CODE[error.code] ?? 'Scia could not complete the operation. Try again.';
  }
  return ENGINE_UNREACHABLE;
}
