import { describe, expect, it, vi } from 'vitest';
import type { EngineAccess } from './engine-access.ts';
import { codePageAddress } from './integration-code.ts';

const code = {
  code: 'ABCD',
  url: 'https://alldebrid.com/pin/?pin=ABCD',
  expiresAt: '2026-11-21T12:10:00.000Z',
  status: 'waiting',
  failure: null,
};

function engineAnswering(body: unknown, status = 200) {
  const fetch = vi.fn<EngineAccess['fetch']>(async () => Response.json(body, { status }));
  return { origin: 'http://127.0.0.1:47821', apiToken: 'token', fetch };
}

describe('codePageAddress', () => {
  it("asks the engine, with main's token, for the page of the code it gave", async () => {
    const engine = engineAnswering({ data: code });

    expect(await codePageAddress('alldebrid', engine, 1000)).toBe(code.url);
    const [url, init] = engine.fetch.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:47821/api/v1/integrations/alldebrid/code');
    expect(init.headers).toEqual({ authorization: 'Bearer token' });
  });

  it('hands the system the address as a browser writes it', async () => {
    const engine = engineAnswering({
      data: { ...code, url: 'https://AllDebrid.com/pin/?pin=ABCD' },
    });

    expect(await codePageAddress('alldebrid', engine, 1000)).toBe(
      'https://alldebrid.com/pin/?pin=ABCD',
    );
  });

  it('never puts in a request what is not the id of a service', async () => {
    const engine = engineAnswering({ data: code });

    for (const id of ['../downloads', 'realdebrid', '', 42, null, { id: 'alldebrid' }]) {
      await expect(codePageAddress(id, engine, 1000)).rejects.toThrow('Not a service.');
    }
    expect(engine.fetch).not.toHaveBeenCalled();
  });

  it("opens nothing that is not on the service's own site, whatever the engine answers", async () => {
    for (const url of [
      'https://alldebrid.com.example/pin/?pin=ABCD',
      'https://example.com/?next=alldebrid.com',
      'file:///C:/Windows/System32/calc.exe',
    ]) {
      await expect(
        codePageAddress('alldebrid', engineAnswering({ data: { ...code, url } }), 1000),
        url,
      ).rejects.toThrow();
    }
  });

  it('refuses when no code is waiting, and an answer that is not a code', async () => {
    await expect(
      codePageAddress('alldebrid', engineAnswering({ error: {} }, 404), 1000),
    ).rejects.toThrow('No code');
    await expect(
      codePageAddress('alldebrid', engineAnswering({ data: {} }), 1000),
    ).rejects.toThrow();
  });

  it('stops waiting for an engine that accepts the question and never answers', async () => {
    const silent: EngineAccess = {
      origin: 'http://127.0.0.1:47821',
      apiToken: 'token',
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    };

    await expect(codePageAddress('alldebrid', silent, 20)).rejects.toThrow('aborted');
  });
});
