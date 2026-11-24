import {
  ApiErrorCode,
  IntegrationCodeFailure,
  type IntegrationId,
  SERVICE_NAME,
  type SettingsPatch,
} from '@scia/contracts';
import { SUPPORT_PAGE } from '@scia/contracts/bridge';
import {
  BundleFailure,
  MagnetFailure,
  PREPARE_LIMIT_SECONDS,
  ServiceFailure,
  UnlockFailure,
} from '@scia/core';
import { ZodError } from 'zod';
import { ApiError } from './api.ts';
import { formatDuration } from './format.ts';

// Errors: the fact, then the remedy. No blame, no "Oops". INVALID_REQUEST has no sentence here: it
// answers links, a choice of files, a setting and a folder alike, and each caller that meets it
// names what was refused (#142).
const BY_CODE: Readonly<Record<string, string>> = {
  [ApiErrorCode.NotFound]: 'This download is no longer in the list.',
  [ApiErrorCode.Conflict]: 'The download has already changed state. Try again in a moment.',
  [ApiErrorCode.Unauthorized]:
    'Scia does not recognize this window. Close the app and open it again.',
};

export const ENGINE_UNREACHABLE = 'Scia’s engine is not responding. Trying again…';

// Main says only that it failed. The engine being silent is the rare cause; a file that is no
// longer where it was downloaded is the common one.
export const FILE_NOT_OPENED = 'Scia could not open the file. It may have been moved or deleted.';

// Main says only that it failed: no browser took the page. The place is how a person types it.
const supportPage = new URL(SUPPORT_PAGE);
export const SUPPORT_PAGE_NOT_OPENED = `Scia could not open the page. Go to ${supportPage.host}${supportPage.pathname}.`;

// Said only when main answers that the engine refused the folder the person chose: one it
// cannot make, or cannot write to. Any other failure of that ask is not about a folder.
export const FOLDER_REFUSED =
  'Scia could not use the folder you chose. Choose one it can write to.';

// Said when main failed — the system's dialog, or an engine silent before or after it — or said
// what the page does not know, and the folder read again is the one before (#142).
export const FOLDER_NOT_CHANGED = 'Scia could not change the download folder. Try again.';

// Said when the engine refused, as no request it takes, what the page sent of a paste or of the
// field: the page reads them by the engine's own contract and sends at most MAX_URLS_PER_REQUEST
// at a time, so no cause a person can mend is known (#142). The field keeps what was refused,
// typed or pasted, and "these" points at it; a paste on the page has no field to point at.
export function addRefusedMessage(sent: 'links' | 'magnets', fromField: boolean): string {
  return fromField
    ? `Scia’s engine did not take these ${sent}.`
    : `Scia’s engine did not take the ${sent} you pasted.`;
}

// What each setting the page changes is called in a sentence: the change lost is named (#142).
const SETTING_CHANGED: Readonly<Record<keyof SettingsPatch, string>> = {
  maxConcurrentDownloads: 'the number of simultaneous downloads',
  connectionsPerDownload: 'the number of connections per download',
  speedLimitBytesPerSecond: 'the speed limit',
  theme: 'the theme',
  betaUpdates: 'whether it updates to beta versions',
  watchClipboard: 'whether it takes links from the clipboard',
};

// Refused, out of its range, not answered: what is true of every cause is that the setting stays
// as the engine keeps it — which the control shows. A window the engine does not recognize has a
// remedy of its own.
export function settingNotChangedMessage(setting: keyof SettingsPatch, error: unknown): string {
  if (error instanceof ApiError && error.code === ApiErrorCode.Unauthorized) {
    return errorMessage(error);
  }
  return `Scia could not change ${SETTING_CHANGED[setting]}. Try again.`;
}

// What each service is called, wherever it is named: the contract's, which main names it by too.
export { SERVICE_NAME };

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
  // A service connected meanwhile, or another code asked for: whatever it was, none came.
  [ApiErrorCode.Conflict]: (service) =>
    `Scia could not get a code from ${service}. Try again in a moment.`,
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
    `${service} did not accept the key it gave for this code. Get a new code.`,
  [IntegrationCodeFailure.KeyBlocked]: (service) =>
    `${service} is blocking the key from here. If ${service} emailed you about a new sign-in, confirm it; otherwise check your network. Then get a new code.`,
  [IntegrationCodeFailure.AccountBanned]: (service) => `${service} says this account is banned.`,
  [IntegrationCodeFailure.NetworkRefused]: (service) =>
    `${service} does not serve this network: it refuses servers and some VPNs. Connect from another network, then get a new code.`,
  // The account could not be asked about once the code was confirmed, or something Scia does
  // not understand: what is true of all of them is that nothing was connected.
  [IntegrationCodeFailure.Unavailable]: (service) =>
    `Scia could not finish connecting with ${service}. Get a new code.`,
  [IntegrationCodeFailure.KeyNotKept]: () =>
    'Scia could not keep the key safely on this computer. Nothing was connected.',
};

export function codeFailedMessage(failure: IntegrationCodeFailure, id: IntegrationId): string {
  return CODE_FAILED[failure](SERVICE_NAME[id]);
}

// Said on the row of a magnet the service gave no files for (#137). Every sentence of the
// service's refusal begins with who said so.
const MAGNET_FAILED: Readonly<Record<MagnetFailure, (service: string) => string>> = {
  [MagnetFailure.Invalid]: (service) => `${service} does not take this as a magnet.`,
  [MagnetFailure.Limit]: (service) =>
    `${service} already has as many magnets for this account as it allows. Remove some on ${service}, then try again.`,
  [MagnetFailure.TooLarge]: (service) => `${service} says this magnet is too large to fetch.`,
  // No peer, too slow, an error of its own, its links removed, deleted on its site by the person,
  // an empty list: true of all of them is that it gave no files, and names no cause.
  [MagnetFailure.Failed]: (service) => `${service} gave no files for this magnet. Try again later.`,
  [MagnetFailure.Unreadable]: (service) =>
    `Scia cannot take the list of files ${service} gave for this magnet: too many, too deep, or not links.`,
  // The same sentence as a link's: a refused key is one fact, whatever it was for. "Connect
  // again", not "a new key": a code is the main way to connect (#136).
  [MagnetFailure.KeyRefused]: (service) =>
    `${service} no longer accepts the key. In Settings, disconnect it and connect again, then try again.`,
  [MagnetFailure.KeyBlocked]: (service) =>
    `${service} is blocking the key from here. If ${service} emailed you about a new sign-in, confirm it; otherwise check your network, then try again.`,
  [MagnetFailure.AccountBanned]: (service) => `${service} says the account is banned.`,
  [MagnetFailure.NetworkRefused]: (service) =>
    `${service} does not serve this network: it refuses servers and some VPNs. Try again from another network.`,
  [MagnetFailure.Unavailable]: (service) =>
    `Scia could not tell from ${service}'s answer what became of this magnet. Try again in a moment.`,
  [MagnetFailure.NotPremium]: (service) => `${service} fetches magnets for premium accounts only.`,
  // Said with no service connected, so it names the one there is to connect.
  [MagnetFailure.NeedsService]: () =>
    `This is a magnet: Scia downloads magnets through ${SERVICE_NAME.alldebrid}. Connect ${SERVICE_NAME.alldebrid} in Settings, then try again.`,
};

export function magnetFailureMessage(failure: MagnetFailure): string {
  return MAGNET_FAILED[failure](SERVICE_NAME.alldebrid);
}

// Said when Retry or Remove of a magnet was refused: its state moved on meanwhile.
const MAGNET_MOVED: Readonly<Record<string, string>> = {
  [ApiErrorCode.NotFound]: 'This magnet is no longer in the list.',
  // Only Retry meets it: the magnet is no longer failed, so it is already on its way again.
  [ApiErrorCode.Conflict]: 'This magnet is already being sent again.',
};

export function magnetActionMessage(error: unknown): string {
  return (
    (error instanceof ApiError ? said(MAGNET_MOVED, error.code) : undefined) ?? errorMessage(error)
  );
}

// A code is a word from outside: looked up among a table's own keys, never its prototype's.
function said(table: Readonly<Record<string, string>>, code: string): string | undefined {
  return Object.hasOwn(table, code) ? table[code] : undefined;
}

// What the service said of the account itself when it was asked about its magnets (#138), each
// true of its cause alone, with its remedy: the sentences Settings says of the same refusal, but
// where Settings names a control of its own. What is mended in Settings — the key connected again,
// a service connected — is asked again when Settings closes; what is mended elsewhere is seen at
// the next ask.
function accountRefused(
  code: string,
): { readonly text: string; readonly heals: boolean } | undefined {
  const service = SERVICE_NAME.alldebrid;
  switch (code) {
    case ApiErrorCode.KeyRefused:
      // Settings' own sentence sits beside its Disconnect: read anywhere else, it says where to
      // act, and to connect again, by a code or a key (#136), as a link's row says.
      return {
        text: `${service} no longer accepts the key. In Settings, disconnect it and connect again.`,
        heals: false,
      };
    case ApiErrorCode.ServiceNeeded:
      return { text: `${service} is no longer connected. Connect it in Settings.`, heals: false };
    case ApiErrorCode.KeyBlocked:
    case ApiErrorCode.AccountBanned:
    case ApiErrorCode.NetworkRefused:
      return { text: serviceTroubleMessage(code, 'alldebrid'), heals: true };
    case ApiErrorCode.NotPremium:
      return { text: `${service} fetches magnets for premium accounts only.`, heals: true };
    default:
      return undefined;
  }
}

// Why the panel's last ask of the account gave no list, and whether it goes on asking.
// An engine that did not answer says nothing here: the notice that it is not responding does.
export interface AccountTrouble {
  readonly text: string | null;
  readonly heals: boolean;
}

export function accountTrouble(error: unknown): AccountTrouble {
  // The engine answered, in a shape the page does not read: nothing else will say it.
  if (error instanceof ZodError) {
    return { text: 'Scia could not read the magnets of the account just now.', heals: true };
  }
  if (!(error instanceof ApiError)) return { text: null, heals: true };
  const refused = accountRefused(error.code);
  if (refused !== undefined) return refused;
  return error.code === ApiErrorCode.Unavailable
    ? { text: `${SERVICE_NAME.alldebrid} could not be asked just now.`, heals: true }
    : { text: 'Scia could not read the magnets of the account just now.', heals: true };
}

// Said when a magnet of the account was not taken into the list (#138): the account moved on
// since the panel last read it, or what the service said of the account.
const ACCOUNT_MAGNET_MOVED: Readonly<Record<string, string>> = {
  [ApiErrorCode.NotFound]: `This magnet is no longer on the ${SERVICE_NAME.alldebrid} account.`,
  [ApiErrorCode.Conflict]: 'This magnet is already in Scia’s list, or no longer ready.',
  [ApiErrorCode.Unavailable]: `${SERVICE_NAME.alldebrid} could not be asked just now. Try again in a moment.`,
};

export function accountMagnetMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return errorMessage(error);
  return (
    said(ACCOUNT_MAGNET_MOVED, error.code) ??
    accountRefused(error.code)?.text ??
    errorMessage(error)
  );
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
    `${service} no longer accepts the key. In Settings, disconnect it and connect again, then try again.`,
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

// Why a link that opens into several files gave none to choose from (#181): what the service said
// of the key, the network or the account as a link's row says it; the rest in words of its own.
const BUNDLE_FAILED: Readonly<Record<BundleFailure, (service: string) => string>> = {
  // The redirector does not open this site, or could not open this link: true of both.
  [BundleFailure.Refused]: (service) => `${service} could not open this link.`,
  [BundleFailure.Empty]: (service) => `${service} found no file it can get behind this link.`,
  [BundleFailure.KeyRefused]: (service) => LINK_NOT_UNLOCKED[ServiceFailure.KeyRefused](service),
  [BundleFailure.KeyBlocked]: (service) => LINK_NOT_UNLOCKED[ServiceFailure.KeyBlocked](service),
  [BundleFailure.AccountBanned]: (service) =>
    LINK_NOT_UNLOCKED[ServiceFailure.AccountBanned](service),
  [BundleFailure.NetworkRefused]: (service) =>
    LINK_NOT_UNLOCKED[ServiceFailure.NetworkRefused](service),
  [BundleFailure.Unavailable]: (service) => LINK_NOT_UNLOCKED[ServiceFailure.Unavailable](service),
  [BundleFailure.NotPremium]: (service) =>
    `${service} opens links like this for premium accounts only.`,
  // A file host's folder with no service connected, also one whose service left while it was
  // opened: a protector's or a shortener's link is then fetched as it stands.
  [BundleFailure.NeedsService]: () =>
    `This link opens into several files through ${SERVICE_NAME.alldebrid}. Connect ${SERVICE_NAME.alldebrid} in Settings, then try again.`,
};

export function bundleFailureMessage(failure: BundleFailure): string {
  return BUNDLE_FAILED[failure](SERVICE_NAME.alldebrid);
}

// Said when a press on the row of such a link was refused: it moved on meanwhile.
const BUNDLE_MOVED: Readonly<
  Record<'start' | 'retry' | 'remove', Readonly<Record<string, string>>>
> = {
  start: { [ApiErrorCode.NotFound]: 'This link is no longer in the list.' },
  // Only Retry meets a conflict a person can read: the link is no longer failed.
  retry: {
    [ApiErrorCode.NotFound]: 'This link is no longer in the list.',
    [ApiErrorCode.Conflict]: 'This link is already being opened again.',
  },
  remove: { [ApiErrorCode.NotFound]: 'This link is no longer in the list.' },
};

export function bundleActionMessage(error: unknown, action: 'start' | 'retry' | 'remove'): string {
  return (
    (error instanceof ApiError ? said(BUNDLE_MOVED[action], error.code) : undefined) ??
    errorMessage(error)
  );
}

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
    return said(BY_CODE, error.code) ?? 'Scia could not complete the operation. Try again.';
  }
  return ENGINE_UNREACHABLE;
}

// The question an update downloaded asks, and what it says when Scia does not restart for it.
// Scia installs an update at a quit the person asks for (docs/adr/0007-automatic-updates.md), and
// restarts for it only while nothing downloads (#133).
export function updateQuestion(version: string): string {
  return `Restart now to install ${version}?`;
}

// A paused download holds no restart back (isUnderWay), so pausing is the way to restart now (#159).
// The note stays open after the last download ends: it says nothing of whether Scia downloads now
// (#257).
export function updateWhileDownloading(version: string): string {
  return `${version} installs when you quit Scia. Pause your downloads to restart now.`;
}

// Main did not restart: a download began meanwhile, or the engine did not say what it was doing.
export function updateNotRestarted(version: string): string {
  return `Scia could not restart now. ${version} installs when you quit Scia.`;
}
