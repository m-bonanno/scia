import { describe, expect, it, vi } from 'vitest';
import { checkPairing, sendToScia } from './scia-client.ts';

const pairing = { token: 'code', port: 47821 };
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
const answering = (status: number) => vi.fn<Fetch>(async () => new Response(null, { status }));

describe('sendToScia', () => {
  it('posts the links to the app on this computer, with the pairing code and the page', async () => {
    const fetchFn = vi.fn<Fetch>(async () => new Response('{}', { status: 201 }));

    const outcome = await sendToScia(
      pairing,
      ['https://example.com/a.zip'],
      'https://example.com/page',
      fetchFn,
    );

    expect(outcome).toBe('sent');
    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:47821/api/v1/downloads', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer code' },
      body: JSON.stringify({
        urls: ['https://example.com/a.zip'],
        referrer: 'https://example.com/page',
      }),
    });
  });

  it('sends only what the app can fetch, and no referrer that is not a web page', async () => {
    const fetchFn = vi.fn<Fetch>(async () => new Response('{}', { status: 201 }));

    await sendToScia(
      pairing,
      ['blob:https://example.com/1', 'https://example.com/a.zip', 'data:text/plain,x'],
      'chrome://newtab/',
      fetchFn,
    );

    expect(fetchFn.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ urls: ['https://example.com/a.zip'] }),
    );
  });

  it('asks nothing of the app before the extension is paired, or with nothing to send', async () => {
    const fetchFn = answering(201);

    expect(
      await sendToScia({ token: '', port: 47821 }, ['https://a.test/x'], undefined, fetchFn),
    ).toBe('not-paired');
    expect(await sendToScia(pairing, ['blob:https://a.test/1'], undefined, fetchFn)).toBe(
      'refused',
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('tells a closed app from one that refuses', async () => {
    const closed = vi.fn<Fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });

    expect(await sendToScia(pairing, ['https://a.test/x'], undefined, closed)).toBe('unreachable');
    expect(await sendToScia(pairing, ['https://a.test/x'], undefined, answering(401))).toBe(
      'refused',
    );
  });
});

describe('checkPairing', () => {
  it('says whether the app takes the code, without adding a download', async () => {
    const fetchFn = answering(204);

    expect(await checkPairing(pairing, fetchFn)).toBe('sent');
    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:47821/api/v1/extension/check', {
      headers: { 'content-type': 'application/json', authorization: 'Bearer code' },
    });
    expect(await checkPairing(pairing, answering(401))).toBe('refused');
  });
});
