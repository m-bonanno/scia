import { IntegrationId } from '@scia/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type KeyAnswer, type KeyRequest, MemoryVault, ParentVault } from './key-vault.ts';
import type { ParentPort } from './parent-port.ts';

// Made up: no account anywhere has this key.
const KEY = 'spec-key-0000000000000000';

// Main, as the engine sees it: what it was sent, and a way to answer.
function aParent() {
  const sent: KeyRequest[] = [];
  const listeners: ((event: { readonly data: unknown }) => void)[] = [];
  const port: ParentPort = {
    postMessage: (message) => {
      sent.push(message as KeyRequest);
    },
    on: (_event, listener) => {
      listeners.push(listener);
    },
  };
  const say = (data: unknown) => {
    for (const listener of listeners) listener({ data });
  };
  return { port, sent, say };
}

describe('ParentVault', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks main for a key, and answers the one main keeps', async () => {
    const parent = aParent();
    const vault = new ParentVault(parent.port);

    const read = vault.read(IntegrationId.AllDebrid);
    const [request] = parent.sent;
    parent.say({ type: 'key', id: request!.id, ok: true, key: KEY } satisfies KeyAnswer);

    expect(request).toMatchObject({ type: 'key', action: 'read', name: 'alldebrid' });
    expect(await read).toBe(KEY);
  });

  it('answers that there is no key when main keeps none', async () => {
    const parent = aParent();
    const vault = new ParentVault(parent.port);

    const read = vault.read(IntegrationId.AllDebrid);
    parent.say({ type: 'key', id: parent.sent[0]!.id, ok: true } satisfies KeyAnswer);

    expect(await read).toBeUndefined();
  });

  it('hands main the key to keep, and the name of the one to remove', async () => {
    const parent = aParent();
    const vault = new ParentVault(parent.port);

    const written = vault.write(IntegrationId.AllDebrid, KEY);
    parent.say({ type: 'key', id: parent.sent[0]!.id, ok: true } satisfies KeyAnswer);
    await written;
    const removed = vault.remove(IntegrationId.AllDebrid);
    parent.say({ type: 'key', id: parent.sent[1]!.id, ok: true } satisfies KeyAnswer);
    await removed;

    expect(parent.sent[0]).toMatchObject({ action: 'write', name: 'alldebrid', key: KEY });
    expect(parent.sent[1]).toMatchObject({ action: 'remove', name: 'alldebrid' });
    expect(parent.sent[1]).not.toHaveProperty('key');
  });

  it('gives each request its own answer, in whatever order they come', async () => {
    const parent = aParent();
    const vault = new ParentVault(parent.port);

    const first = vault.read(IntegrationId.AllDebrid);
    const second = vault.read(IntegrationId.AllDebrid);
    parent.say({ type: 'key', id: parent.sent[1]!.id, ok: true, key: 'second' });
    parent.say({ type: 'key', id: parent.sent[0]!.id, ok: true, key: 'first' });

    expect(await first).toBe('first');
    expect(await second).toBe('second');
  });

  it('fails when main refuses, for a read as for a write', async () => {
    const parent = aParent();
    const vault = new ParentVault(parent.port);

    const read = vault.read(IntegrationId.AllDebrid);
    parent.say({ type: 'key', id: parent.sent[0]!.id, ok: false } satisfies KeyAnswer);
    const written = vault.write(IntegrationId.AllDebrid, KEY);
    parent.say({ type: 'key', id: parent.sent[1]!.id, ok: false } satisfies KeyAnswer);

    await expect(read).rejects.toThrow('Main did not');
    await expect(written).rejects.toThrow('Main did not');
  });

  it('does not wait for a main that says nothing', async () => {
    const vault = new ParentVault(aParent().port, 20);

    await expect(vault.read(IntegrationId.AllDebrid)).rejects.toThrow('Main did not');
  });

  it('waits longer for a write: main answers it once what opens the key is on disk (#69)', async () => {
    const parent = aParent();
    const vault = new ParentVault(parent.port, 20, 2000);

    const written = vault.write(IntegrationId.AllDebrid, KEY);
    const asked = performance.now();
    const read = vault.read(IntegrationId.AllDebrid);
    await expect(read).rejects.toThrow('Main did not read');
    // A read is not given the write's time.
    expect(performance.now() - asked).toBeLessThan(1000);
    parent.say({ type: 'key', id: parent.sent[0]!.id, ok: true } satisfies KeyAnswer);

    await expect(written).resolves.toBeUndefined();
  });

  it('does not wait for ever for a write either', async () => {
    const vault = new ParentVault(aParent().port, 10, 10);

    await expect(vault.write(IntegrationId.AllDebrid, KEY)).rejects.toThrow('Main did not write');
  });

  it('stops counting the time once main has answered', async () => {
    vi.useFakeTimers();
    const parent = aParent();
    const vault = new ParentVault(parent.port);

    const read = vault.read(IntegrationId.AllDebrid);
    parent.say({ type: 'key', id: parent.sent[0]!.id, ok: true } satisfies KeyAnswer);
    await read;

    expect(vi.getTimerCount()).toBe(0);
  });

  it('takes nothing else main says for an answer', async () => {
    const parent = aParent();
    const vault = new ParentVault(parent.port, 20);

    const read = vault.read(IntegrationId.AllDebrid);
    const { id } = parent.sent[0]!;
    for (const other of [
      null,
      'key',
      { type: 'shutdown' },
      { type: 'key', id: id + 1, ok: true },
      { type: 'key', id, ok: 'yes' },
      { type: 'key', id, ok: true, key: 7 },
    ]) {
      parent.say(other);
    }

    await expect(read).rejects.toThrow('Main did not');
  });

  it('never puts the key in what it says of a failure', async () => {
    const parent = aParent();
    const vault = new ParentVault(parent.port);

    const written = vault.write(IntegrationId.AllDebrid, KEY);
    parent.say({ type: 'key', id: parent.sent[0]!.id, ok: false });
    const error = await written.catch((caught: unknown) => caught);

    expect(JSON.stringify([error, (error as Error).message, (error as Error).stack])).not.toContain(
      KEY,
    );
  });
});

describe('MemoryVault', () => {
  it('keeps a key for as long as it lives, and forgets the one removed', async () => {
    const vault = new MemoryVault();

    expect(await vault.read(IntegrationId.AllDebrid)).toBeUndefined();
    await vault.write(IntegrationId.AllDebrid, KEY);
    expect(await vault.read(IntegrationId.AllDebrid)).toBe(KEY);
    await vault.remove(IntegrationId.AllDebrid);
    expect(await vault.read(IntegrationId.AllDebrid)).toBeUndefined();
  });
});
