import type { IntegrationId } from '@scia/contracts';

// What a service made of a link it unlocked.
export interface UnlockedLink {
  // The direct link: fetched as any other, through RemoteSource.
  readonly url: string;
  // What the service calls the file, when it says: a name from a host, as hostile as any.
  readonly fileName: string | undefined;
}

// The PORT a debrid service plugs into (docs/adr/0005): a step before a download reaches its
// bytes, which turns a hoster's link into a direct one. `Integrations` is its adapter; a
// download with no resolver fetches every link as it stands.
export interface LinkResolver {
  // The connected service that takes this link; undefined for a link that is fetched as it
  // stands. Rejects with a ServiceError while a connected service cannot say which links it
  // takes — a link is not started on a guess — and, with no service connected, for a file
  // host's link, which needs one (docs/adr/0006).
  serviceFor(url: string, signal: AbortSignal): Promise<IntegrationId | undefined>;
  // The direct link the service gives for it. Rejects with a ServiceError that says why not,
  // or with the reason of `signal`.
  unlock(service: IntegrationId, url: string, signal: AbortSignal): Promise<UnlockedLink>;
}
