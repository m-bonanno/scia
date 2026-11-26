import net from 'node:net';

// The network guard of a mutation run (.claude/gotchas.md, "Specs"): a mutant that points a run at
// a real host meets this instead (#228). Every connection to a host that is not this computer is
// refused before a name is looked up, in each process that loads it — Vitest's own and its workers
// (vitest.stryker.config.ts), and what a spec starts (`NODE_OPTIONS`). Two roads: Node's own `fetch`,
// which a patch of the socket does not see (#259), and the socket, under `http`, `https`, `tls` and
// `net` alike.

const GUARDED = Symbol.for('scia.net-guard');

function isLocal(host) {
  // A socket given no host connects to this computer.
  if (host === undefined || host === null || host === '') return true;
  const name = String(host)
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return (
    name === 'localhost' ||
    name.endsWith('.localhost') ||
    name === '::1' ||
    name.startsWith('127.') ||
    name.startsWith('::ffff:127.')
  );
}

function refusal(host) {
  return Object.assign(new Error(`net-guard refused ${String(host)}`), { code: 'NET_GUARD' });
}

function hostOfUrl(input) {
  const raw = input instanceof URL ? input.href : typeof input === 'string' ? input : input?.url;
  try {
    return new URL(raw).hostname;
  } catch {
    // Not an address at all: fetch says so itself.
    return undefined;
  }
}

// `connect(options)`, `connect(port, host)`, `connect(path)` — and, from `net.connect`, the same
// arguments normalised into an array (#286). A pipe's path is a string: `http` hands its socket
// `path: null` with a host.
function hostOfConnect(args) {
  let [first, second] = args;
  if (Array.isArray(first)) [first, second] = first;
  if (first !== null && typeof first === 'object') {
    return typeof first.path === 'string' ? '' : first.host;
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return '';
  return typeof second === 'string' ? second : undefined;
}

function guard() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = function guardedFetch(input, init) {
    const host = hostOfUrl(input);
    if (!isLocal(host)) return Promise.reject(refusal(host));
    return realFetch.call(this, input, init);
  };

  const realConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(...args) {
    const host = hostOfConnect(args);
    if (isLocal(host)) return realConnect.apply(this, args);
    // As a connection that failed: the error comes after the caller has its socket.
    process.nextTick(() => this.destroy(refusal(host)));
    return this;
  };
}

// Loaded twice — by `NODE_OPTIONS` and by a setup file — it guards once.
if (globalThis[GUARDED] !== true) {
  guard();
  globalThis[GUARDED] = true;
}
