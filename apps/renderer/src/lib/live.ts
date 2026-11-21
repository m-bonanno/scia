import {
  API_PREFIX,
  type Download,
  type Magnet,
  SNAPSHOT_EVENT,
  snapshotSchema,
} from '@scia/contracts';
import { useSyncExternalStore } from 'react';
import { authorization } from './api.ts';
import { readServerSentEvents } from './sse.ts';

export const Connection = { Connecting: 'connecting', Live: 'live', Offline: 'offline' } as const;
export type Connection = (typeof Connection)[keyof typeof Connection];

export interface LiveState {
  readonly connection: Connection;
  readonly downloads: readonly Download[];
  // The magnets the service is fetching, or could not (#137).
  readonly magnets: readonly Magnet[];
}

const FIRST_RETRY_MS = 500;
const LONGEST_RETRY_MS = 5000;

let state: LiveState = { connection: Connection.Connecting, downloads: [], magnets: [] };
const listeners = new Set<() => void>();

function set(next: LiveState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshotOf(
  data: string,
): { readonly downloads: readonly Download[]; readonly magnets: readonly Magnet[] } | undefined {
  try {
    const parsed = snapshotSchema.safeParse(JSON.parse(data));
    return parsed.success
      ? { downloads: parsed.data.downloads, magnets: parsed.data.magnets }
      : undefined;
  } catch {
    return undefined;
  }
}

async function listen(signal: AbortSignal): Promise<void> {
  // Read anew at every step: the page may have stopped listening during a wait.
  const stopped = () => signal.aborted;
  let retryMs = FIRST_RETRY_MS;
  while (!stopped()) {
    try {
      const response = await fetch(`${API_PREFIX}/events`, { headers: authorization(), signal });
      if (response.ok && response.body !== null) {
        retryMs = FIRST_RETRY_MS;
        for await (const event of readServerSentEvents(response.body)) {
          const lists = event.event === SNAPSHOT_EVENT ? snapshotOf(event.data) : undefined;
          if (lists !== undefined) set({ connection: Connection.Live, ...lists });
        }
      }
    } catch {
      // The engine is restarting, or the page is closing: the loop decides which.
    }
    if (stopped()) return;
    // The last list stays on screen: what was downloading is still true enough to read.
    set({ ...state, connection: Connection.Offline });
    await new Promise((resolve) => setTimeout(resolve, retryMs));
    retryMs = Math.min(retryMs * 2, LONGEST_RETRY_MS);
  }
}

// The engine's list of downloads, pushed to the page as it changes. Returns the stop.
export function startLive(): () => void {
  const controller = new AbortController();
  void listen(controller.signal);
  return () => {
    controller.abort();
  };
}

export function useLive(): LiveState {
  return useSyncExternalStore(subscribe, () => state);
}
