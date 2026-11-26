import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

function fetched(input) {
  return fetch(input, { signal: AbortSignal.timeout(NOT_REFUSED_WITHIN_MS) }).then(
    () => 'answered',
    (error) => error.message,
  );
}

// What a program prints, and its code, once it has ended; ended at the limit if it has not.
function printedBy(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let printed = '';
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8').on('data', (chunk) => (printed += chunk));
    }
    const timer = setTimeout(() => child.kill(), NOT_REFUSED_WITHIN_MS * 2);
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, printed: printed.trim() });
    });
  });
}

// A lookup that asks no one: a name the guard lets through is handed to it, and said.
const lookupOfNoOne = (host, _options, callback) => {
  callback(new Error(`looked up ${host}`));
};

describe('the network guard of a mutation run', () => {
  it("refuses Node's fetch, given a text, a URL or a Request", async () => {
    expect(await fetched(`http://${RESERVED}/`)).toMatch(REFUSED);
    expect(await fetched(new URL(`http://${RESERVED}/`))).toMatch(REFUSED);
    expect(await fetched(new Request(`http://${RESERVED}/`))).toMatch(REFUSED);
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
    expect(await outcomeOf(() => new net.Socket().connect('80', RESERVED))).toMatch(REFUSED);
    expect(await outcomeOf(() => tls.connect({ host: RESERVED, port: 443 }))).toMatch(REFUSED);
  });

  it('refuses a name or an address that only reads like this computer, before any lookup', async () => {
    for (const host of ['127.example.invalid', 'scia.localhost', '::ffff:192.0.2.1']) {
      const outcome = await outcomeOf(() => net.connect({ host, port: 80, lookup: lookupOfNoOne }));
      expect(outcome, host).toBe(`net-guard refused ${host}`);
    }
  });

  it('refuses in a Node process a spec starts', async () => {
    const node = await printedBy(process.execPath, [
      '--input-type=module',
      '--eval',
      `await fetch('http://${RESERVED}/', { signal: AbortSignal.timeout(${String(NOT_REFUSED_WITHIN_MS)}) })` +
        ".then(() => console.log('answered'), (error) => console.log(error.message));",
    ]);

    expect(node.printed).toMatch(REFUSED);
  });

  it('refuses a program that is not Node: one that reads a proxy, and git', async () => {
    const curl = await printedBy('curl', ['-sS', '--max-time', '3', `http://${RESERVED}/`]);
    const git = await printedBy('git', ['ls-remote', `http://${RESERVED}/scia.git`]);

    // Code 7 is curl's "could not connect": to the proxy, when the reserved host is not named.
    expect({ code: curl.code, named: curl.printed.includes(RESERVED) }, curl.printed).toEqual({
      code: 7,
      named: false,
    });
    expect(git.printed, git.printed).toMatch(/transport 'http' not allowed/);
  });

  it('lets a pipe on this computer answer', async () => {
    const pipe =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\scia-net-guard-${String(process.pid)}`
        : path.join(tmpdir(), `scia-net-guard-${String(process.pid)}.sock`);
    const server = net.createServer((socket) => socket.end());
    await new Promise((resolve) => server.listen(pipe, resolve));
    try {
      expect(await outcomeOf(() => net.connect({ path: pipe }))).toBe('connected');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('lets a host on this computer answer, Node and a program that is not', async () => {
    const server = http.createServer((_, response) => response.end('here'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address();
      const answer = await fetch(`http://127.0.0.1:${String(port)}/`);
      expect(await answer.text()).toBe('here');
      expect(await outcomeOf(() => net.connect(port, 'localhost'))).toBe('connected');
      // A socket given no host connects to this computer.
      expect(await outcomeOf(() => net.connect(port))).toBe('connected');
      const curl = await printedBy('curl', [
        '-sS',
        '--max-time',
        '3',
        `http://127.0.0.1:${String(port)}/`,
      ]);
      expect(curl).toEqual({ code: 0, printed: 'here' });
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
