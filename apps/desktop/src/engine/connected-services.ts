import { type IntegrationId, SERVICE_NAME } from '@scia/contracts';

// Follows which services the engine says are connected, from one look to the next, and names
// those that were not at the look before: a code confirmed while Settings is closed connects one
// that nobody is looking at (#146). What was connected at the first look is old news. It is kept
// across an engine that restarts, which reads the same key back.
export class NewlyConnected {
  #before: ReadonlySet<IntegrationId> | undefined;

  seen(connected: readonly IntegrationId[]): IntegrationId[] {
    const before = this.#before;
    this.#before = new Set(connected);
    if (before === undefined) return [];
    return connected.filter((id) => !before.has(id));
  }
}

export interface ConnectedNotice {
  readonly title: string;
  readonly body: string;
}

export function connectedNotice(id: IntegrationId): ConnectedNotice {
  return {
    title: `${SERVICE_NAME[id]} is connected`,
    body: 'Links of file hosts and magnets now download through your account.',
  };
}
