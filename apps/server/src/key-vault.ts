import type { IntegrationId } from '@scia/contracts';
import type { ParentPort } from './parent-port.ts';

// The PORT the key of a connected service is kept through (docs/adr/0004). The engine holds a
// key in memory and nowhere else: what keeps it between two runs is the operating system's
// protected storage, which only main can reach.
export interface KeyVault {
  // Undefined when no key is kept under the name.
  read(name: IntegrationId): Promise<string | undefined>;
  write(name: IntegrationId, key: string): Promise<void>;
  remove(name: IntegrationId): Promise<void>;
}

// What the engine asks main, and what main answers, on the channel between the two.
export interface KeyRequest {
  readonly type: 'key';
  readonly id: number;
  readonly action: 'read' | 'write' | 'remove';
  readonly name: string;
  readonly key?: string;
}
export interface KeyAnswer {
  readonly type: 'key';
  readonly id: number;
  // False when main could not do it: no protected storage, a key it cannot read back.
  readonly ok: boolean;
  readonly key?: string;
}

// Main is on this computer: one that has not answered by then is not going to.
const ANSWER_LIMIT_MS = 5000;

function isAnswerTo(id: number, message: unknown): message is KeyAnswer {
  if (typeof message !== 'object' || message === null) return false;
  const answer = message as Partial<Record<keyof KeyAnswer, unknown>>;
  return (
    answer.type === 'key' &&
    answer.id === id &&
    typeof answer.ok === 'boolean' &&
    (answer.key === undefined || typeof answer.key === 'string')
  );
}

// The vault of the real app: main keeps the keys, encrypted by the system.
export class ParentVault implements KeyVault {
  readonly #port: ParentPort;
  readonly #limitMs: number;
  readonly #waiting = new Map<number, (message: unknown) => void>();
  #lastId = 0;

  constructor(port: ParentPort, limitMs = ANSWER_LIMIT_MS) {
    this.#port = port;
    this.#limitMs = limitMs;
    port.on('message', (event) => {
      for (const hear of [...this.#waiting.values()]) hear(event.data);
    });
  }

  async read(name: IntegrationId): Promise<string | undefined> {
    return (await this.#ask('read', name)).key;
  }

  async write(name: IntegrationId, key: string): Promise<void> {
    await this.#ask('write', name, key);
  }

  async remove(name: IntegrationId): Promise<void> {
    await this.#ask('remove', name);
  }

  #ask(action: KeyRequest['action'], name: IntegrationId, key?: string): Promise<KeyAnswer> {
    this.#lastId += 1;
    const id = this.#lastId;
    return new Promise<KeyAnswer>((resolve, reject) => {
      // The failure names the action and never the key.
      const fail = () => {
        this.#waiting.delete(id);
        reject(new Error(`Main did not ${action} the key of ${name}.`));
      };
      const limit = setTimeout(fail, this.#limitMs);
      this.#waiting.set(id, (message) => {
        if (!isAnswerTo(id, message)) return;
        clearTimeout(limit);
        if (message.ok) {
          this.#waiting.delete(id);
          resolve(message);
        } else {
          fail();
        }
      });
      this.#port.postMessage({
        type: 'key',
        id,
        action,
        name,
        ...(key === undefined ? {} : { key }),
      } satisfies KeyRequest);
    });
  }
}

// Under plain Node — the specs, `npm run dev` — nobody keeps a key: it lasts as long as the
// engine does, and is never written anywhere.
export class MemoryVault implements KeyVault {
  readonly #keys = new Map<IntegrationId, string>();

  read(name: IntegrationId): Promise<string | undefined> {
    return Promise.resolve(this.#keys.get(name));
  }

  write(name: IntegrationId, key: string): Promise<void> {
    this.#keys.set(name, key);
    return Promise.resolve();
  }

  remove(name: IntegrationId): Promise<void> {
    this.#keys.delete(name);
    return Promise.resolve();
  }
}
