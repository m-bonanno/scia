import type { MagnetFile, MagnetState, SentMagnet } from './alldebrid.ts';

export type { MagnetFile, MagnetState, SentMagnet };

// The port a debrid service fetches magnets through (#137; docs/adr/0014). `Integrations` is its
// adapter, with the key of the service connected. Each rejects with a ServiceError — `SERVICE_NEEDED`
// when no service is connected — or a MagnetError for a magnet the service no longer has.
export interface MagnetService {
  // The magnets for the service to fetch, each answered on its own.
  send(magnets: readonly string[], signal?: AbortSignal): Promise<SentMagnet[]>;
  // Where every magnet of the account is, in one question.
  states(signal?: AbortSignal): Promise<MagnetState[]>;
  // The files of a ready magnet, with their folders.
  files(id: number, signal?: AbortSignal): Promise<MagnetFile[]>;
}
