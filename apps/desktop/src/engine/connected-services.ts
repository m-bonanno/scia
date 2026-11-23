import {
  type CodeConnectFailed,
  CodeConnectFailure,
  type IntegrationId,
  SERVICE_NAME,
} from '@scia/contracts';

// Follows which services the engine says are connected, from one look to the next, and names
// those that were not at the look before: a code confirmed while nobody looks at Scia connects one
// (#146). What was connected at the first look is old news. It is kept across an engine that
// restarts: one that reads its key back says the same, and one that cannot says none, so that the
// next connection is named.
export class NewlyConnected {
  #before: ReadonlySet<IntegrationId> | undefined;

  seen(connected: readonly IntegrationId[]): IntegrationId[] {
    const before = this.#before;
    this.#before = new Set(connected);
    if (before === undefined) return [];
    return connected.filter((id) => !before.has(id));
  }
}

// Follows the last confirmed code whose key connected nothing, as the engine says it, and names it
// once: a failure is told from the one before by its moment (the owner, #146). What the engine held
// at the first look is old news.
export class NewCodeFailure {
  #before: string | null | undefined;

  seen(failed: CodeConnectFailed | null): CodeConnectFailed | undefined {
    const before = this.#before;
    this.#before = failed?.at ?? null;
    if (before === undefined || failed === null || failed.at === before) return undefined;
    return failed;
  }
}

export interface ServiceNotice {
  readonly title: string;
  readonly body: string;
}

export function connectedNotice(id: IntegrationId): ServiceNotice {
  return {
    title: `${SERVICE_NAME[id]} is connected`,
    body: 'Links of file hosts and magnets now go through your account.',
  };
}

// Each true of every cause its code covers, and short enough for the four lines the system draws.
const WHY_NOT_CONNECTED: Readonly<Record<CodeConnectFailure, (service: string) => string>> = {
  [CodeConnectFailure.KeyRefused]: (service) =>
    `${service} did not accept the key it gave for the code. In Settings, get a new code.`,
  // AllDebrid says it of a network it blocks, and of a new place until the sign-in it emailed
  // about is confirmed.
  [CodeConnectFailure.KeyBlocked]: (service) =>
    `${service} is blocking the key from here. Confirm its email about a new sign-in, or check your network, then get a new code in Settings.`,
  [CodeConnectFailure.AccountBanned]: (service) => `${service} says this account is banned.`,
  [CodeConnectFailure.NetworkRefused]: (service) =>
    `${service} does not serve this network: it refuses servers and some VPNs. Connect from another network, then get a new code in Settings.`,
  // The account could not be asked about once the code was confirmed, or answered what Scia does
  // not understand.
  [CodeConnectFailure.Unavailable]: (service) =>
    `Scia could not finish connecting with ${service}. In Settings, get a new code.`,
  [CodeConnectFailure.KeyNotKept]: () =>
    'Scia could not keep the key safely on this computer. Nothing was connected.',
};

export function codeFailedNotice(failed: CodeConnectFailed): ServiceNotice {
  const service = SERVICE_NAME[failed.service];
  return {
    title: `${service} could not be connected`,
    body: WHY_NOT_CONNECTED[failed.failure](service),
  };
}
