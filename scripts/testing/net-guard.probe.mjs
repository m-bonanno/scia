import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { describe, expect, it } from 'vitest';

// The probe a mutation run starts with (`npm run mutate`), in a worker of vitest.stryker.config.ts:
// the guard is seen refusing, on each road apart, before a mutant is trusted with the network
// (.claude/gotchas.md, "Specs"). Its host is TEST-NET-1 (RFC 5737), which routes nowhere: where
// the guard lets a request through, it reaches no one, and the probe destroys what it opened.
const RESERVED = '192.0.2.1';
const REFUSED = /^net-guard refused 192\.0\.2\.1$/;
const NOT_REFUSED_WITHIN_MS = 2000;

function outcomeOf(open) {
  return new Promise((resolve) => {
    const emitter = open();
    const timer = setTimeout(() => {
      emitter.destroy();
      resolve('not refused');
    }, NOT_REFUSED_WITHIN_MS);
    const end = (outcome) => {
      clearTimeout(timer);
      emitter.destroy();
      resolve(outcome);
    };
    emitter.once('error', (error) => end(error.message));
    emitter.once('connect', () => end('connected'));
    emitter.once('secureConnect', () => end('connected'));
    emitter.once('response', () => end('answered'));
  });
}

describe('the network guard of a mutation run', () => {
  it("refuses Node's fetch", async () => {
    const outcome = await fetch(`http://${RESERVED}/`, {
      signal: AbortSignal.timeout(NOT_REFUSED_WITHIN_MS),
    }).then(
      () => 'answered',
      (error) => error.message,
    );

    expect(outcome).toMatch(REFUSED);
  });

  it('refuses http and https', async () => {
    expect(await outcomeOf(() => http.get(`http://${RESERVED}/`))).toMatch(REFUSED);
    expect(await outcomeOf(() => http.request({ host: RESERVED, port: 80 }).end())).toMatch(
      REFUSED,
    );
    expect(await outcomeOf(() => https.get(`https://${RESERVED}/`))).toMatch(REFUSED);
  });

  it('refuses a socket, whichever way it is given its host', async () => {
    expect(await outcomeOf(() => net.connect({ host: RESERVED, port: 80 }))).toMatch(REFUSED);
    expect(await outcomeOf(() => net.connect(80, RESERVED))).toMatch(REFUSED);
    expect(await outcomeOf(() => new net.Socket().connect(80, RESERVED))).toMatch(REFUSED);
    expect(await outcomeOf(() => tls.connect({ host: RESERVED, port: 443 }))).toMatch(REFUSED);
  });

  it('refuses in a process a spec starts', async () => {
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `await fetch('http://${RESERVED}/', { signal: AbortSignal.timeout(${String(NOT_REFUSED_WITHIN_MS)}) })` +
          ".then(() => console.log('answered'), (error) => console.log(error.message));",
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let printed = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (printed += chunk));
    await new Promise((resolve) => child.once('close', resolve));

    expect(printed.trim()).toMatch(REFUSED);
  });

  it('lets a host on this computer answer', async () => {
    const server = http.createServer((_, response) => response.end('here'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address();
      const answer = await fetch(`http://127.0.0.1:${String(port)}/`);
      expect(await answer.text()).toBe('here');
      expect(await outcomeOf(() => net.connect(port, 'localhost'))).toBe('connected');
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
