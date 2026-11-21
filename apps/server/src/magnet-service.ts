import type { MagnetFailure } from '@scia/core';
import type { MagnetFile, MagnetState, SentMagnet } from './alldebrid.ts';

export type { MagnetFile, MagnetState, SentMagnet };

// The port a debrid service fetches magnets through (#137; docs/adr/0014). `Integrations` is its
// adapter, with the key of the service connected. Each rejects with a ServiceError —
// `SERVICE_NEEDED` when no service is connected; what the service says of one magnet is an answer.
export interface MagnetService {
  // The magnets for the service to fetch, each answered on its own.
  send(magnets: readonly string[], signal?: AbortSignal): Promise<SentMagnet[]>;
  // Where every magnet of the account is, in one question.
  states(signal?: AbortSignal): Promise<MagnetState[]>;
  // The files of ready magnets, with their folders, in one question: each answered one is in the
  // map — its files, or why there are none.
  files(
    ids: readonly number[],
    signal?: AbortSignal,
  ): Promise<Map<number, MagnetFile[] | MagnetFailure>>;
}
