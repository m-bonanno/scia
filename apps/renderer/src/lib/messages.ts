import { ApiErrorCode, IntegrationCodeFailure, type IntegrationId } from '@scia/contracts';
import { PREPARE_LIMIT_SECONDS, ServiceFailure, UnlockFailure } from '@scia/core';
import { ApiError } from './api.ts';
import { formatDuration } from './format.ts';

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
  // AllDebrid says it of a key used from a network it blocks, and of one used from a new place
  // until the sign-in it emailed about is confirmed: the sentence is true of both.
  [ApiErrorCode.KeyBlocked]: (service) =>
    `${service} is blocking this key from here. If ${service} emailed you about a new sign-in, confirm it; otherwise check your network, then try again.`,
  [ApiErrorCode.AccountBanned]: (service) => `${service} says this account is banned.`,
  [ApiErrorCode.NetworkRefused]: (service) =>
    `${service} does not serve this network: it refuses servers and some VPNs. Connect from another network, then try again.`,
  // Not answering, under maintenance, or answering what Scia does not understand: what is
  // true of all of them is that the key was not checked.
  [ApiErrorCode.Unavailable]: (service) =>
    `Scia could not check this key with ${service}. Try again in a moment.`,
  [ApiErrorCode.KeyNotKept]: () =>
    'Scia could not keep the key safely on this computer. Nothing was connected.',
  [ApiErrorCode.InvalidRequest]: (service) =>
    `This is not a key. Copy it again from your ${service} account.`,
};

export function connectFailureMessage(error: unknown, id: IntegrationId): string {
  const text = error instanceof ApiError ? KEY_NOT_TAKEN[error.code] : undefined;
  return text === undefined ? errorMessage(error) : text(SERVICE_NAME[id]);
}

// Said when Settings asked for a code to confirm on the service's site and got none.
const CODE_NOT_GIVEN: Readonly<Record<string, (service: string) => string>> = {
  // Not answering, under maintenance, or answering what Scia does not understand.
  [ApiErrorCode.Unavailable]: (service) =>
    `Scia could not get a code from ${service}. Try again in a moment.`,
  [ApiErrorCode.NetworkRefused]: (service) =>
    `${service} does not serve this network: it refuses servers and some VPNs. Connect from another network, then try again.`,
};

export function codeNotGivenMessage(error: unknown, id: IntegrationId): string {
  const text = error instanceof ApiError ? CODE_NOT_GIVEN[error.code] : undefined;
  return text === undefined ? errorMessage(error) : text(SERVICE_NAME[id]);
}

// Said by a code that connected nothing. "Get a new code" is the button beside it.
const CODE_FAILED: Readonly<Record<IntegrationCodeFailure, (service: string) => string>> = {
  // Its time ran out, or the service, or the engine, no longer knows it.
  [IntegrationCodeFailure.Expired]: () => 'This code is no longer valid. Get a new one.',
  [IntegrationCodeFailure.KeyRefused]: (service) =>
    `${service} did not accept the key it gave for this code. Get a new code, then try again.`,
  [IntegrationCodeFailure.KeyBlocked]: (service) =>
    `${service} is blocking the key from here. If ${service} emailed you about a new sign-in, confirm it; otherwise check your network. Then get a new code.`,
  [IntegrationCodeFailure.AccountBanned]: (service) => `${service} says this account is banned.`,
  [IntegrationCodeFailure.NetworkRefused]: (service) =>
    `${service} does not serve this network: it refuses servers and some VPNs. Connect from another network, then get a new code.`,
  // The account could not be asked about once the code was confirmed, or something Scia does
  // not understand: what is true of all of them is that nothing was connected.
  [IntegrationCodeFailure.Unavailable]: (service) =>
    `Scia could not finish connecting with ${service}. Get a new code, then try again.`,
  [IntegrationCodeFailure.KeyNotKept]: () =>
    'Scia could not keep the key safely on this computer. Nothing was connected.',
};

export function codeFailedMessage(failure: IntegrationCodeFailure, id: IntegrationId): string {
  return CODE_FAILED[failure](SERVICE_NAME[id]);
}

// Said of a service that is connected, when it last answered with a refusal or not at all.
const SERVICE_TROUBLE: Readonly<Record<ServiceFailure, (service: string) => string>> = {
  [ServiceFailure.KeyRefused]: (service) =>
    `${service} no longer accepts the key. Disconnect, then connect with a new one.`,
  [ServiceFailure.KeyBlocked]: (service) =>
    `${service} is blocking the key from here. If ${service} emailed you about a new sign-in, confirm it; otherwise check your network.`,
  [ServiceFailure.AccountBanned]: (service) => `${service} says this account is banned.`,
  [ServiceFailure.NetworkRefused]: (service) =>
    `${service} does not serve this network: it refuses servers and some VPNs. Use it from another network.`,
  [ServiceFailure.Unavailable]: (service) =>
    `Scia could not ask ${service} about this account just now.`,
};

export function serviceTroubleMessage(failure: ServiceFailure, id: IntegrationId): string {
  return SERVICE_TROUBLE[failure](SERVICE_NAME[id]);
}

// Said on the row of a download whose link goes through a service, when the service did not
// give a link for it; and, for a file host's link added with no service connected, what to
// connect. Every sentence of a service's refusal begins with who said so.
const LINK_NOT_UNLOCKED: Readonly<
  Record<ServiceFailure | UnlockFailure, (service: string) => string>
> = {
  [ServiceFailure.KeyRefused]: (service) =>
    `${service} no longer accepts the key. In Settings, disconnect it and connect a new key, then try again.`,
  [ServiceFailure.KeyBlocked]: (service) =>
    `${service} is blocking the key from here. If ${service} emailed you about a new sign-in, confirm it; otherwise check your network, then try again.`,
  [ServiceFailure.AccountBanned]: (service) => `${service} says the account is banned.`,
  [ServiceFailure.NetworkRefused]: (service) =>
    `${service} does not serve this network: it refuses servers and some VPNs. Try again from another network.`,
  // Not answering, under maintenance, or answering what Scia does not understand: what is
  // true of all of them is that the link was not unlocked, and may be the next time.
  [ServiceFailure.Unavailable]: (service) =>
    `${service} could not be asked about this link. Try again in a moment.`,
  [UnlockFailure.NotPremium]: (service) =>
    `${service} unlocks this link for premium accounts only.`,
  [UnlockFailure.LinkDown]: (service) => `${service} says the file is no longer on its host.`,
  [UnlockFailure.LinkPassword]: (service) =>
    `${service} says the link asks for a password, which Scia cannot give yet.`,
  // The host down, its servers full, the link "temporarily unavailable" on it: true of all three.
  [UnlockFailure.HostUnavailable]: (service) =>
    `${service} cannot get this file from its host right now. Try again later.`,
  [UnlockFailure.HostLimit]: (service) =>
    `${service} says the account has reached its limit for this host. Try again later.`,
  [UnlockFailure.LinkRefused]: (service) => `${service} could not unlock this link.`,
  [UnlockFailure.NotReady]: (service) =>
    `${service} was still preparing this link after ${formatDuration(PREPARE_LIMIT_SECONDS)}. Try again later.`,
  // Said with no service connected, so it names the one there is to connect.
  [UnlockFailure.NeedsService]: () =>
    `This link is on a file host: Scia downloads links like this through ${SERVICE_NAME.alldebrid}. Connect ${SERVICE_NAME.alldebrid} in Settings, then try again.`,
  [UnlockFailure.NotConnected]: (service) =>
    `${service} is no longer connected. Connect it in Settings, then try again.`,
};

// Said on the row of a download that went through a service, when the link the service gave
// stopped working — expired, refused, cut. Trying again asks the service for a new one
// (docs/adr/0005-a-service-resolves-a-link.md, point 4).
export function directLinkFailedMessage(status: number | null, via: IntegrationId): string {
  const service = SERVICE_NAME[via];
  const code = status === null ? '' : ` (${String(status)})`;
  return `The link ${service} gave no longer works${code}. Try again: ${service} gives a new one.`;
}

// `via` is null when the service failed before it could say whether the link is one of its
// own: the link belongs to no service yet, and the one that did not answer is not named. It
// is null too for a file host's link added with no service connected, whose sentence names the
// service to connect itself.
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
