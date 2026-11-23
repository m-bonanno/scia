import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { endOfProcess } from './process-end.ts';

// What the engine does at its end (apps/server/src/main.ts): lines written, its last line, then
// `process.exit` at once.
const ENDS_LIKE_THE_ENGINE = `
  console.log(Array.from({ length: 256 }, () => '{"event":"progress"}').join('\\n'));
  console.log('stopped');
  process.exit(0);
`;

// Leaves a process of its own holding its output, as a program the engine started could. Detached,
// or Windows ends it with its parent (libuv's job object).
const LEAVES_ITS_OUTPUT_OPEN = `
  const { spawn } = require('node:child_process');
  const held = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
    stdio: 'inherit',
    detached: true,
  });
  console.log(String(held.pid));
  setTimeout(() => process.exit(0), 200);
`;

const held: number[] = [];

afterEach(() => {
  for (const pid of held.splice(0)) {
    try {
      process.kill(pid);
    } catch {
      // Already gone.
    }
  }
});

// Electron learns of a utility process's exit on another channel than its pipes, so main can hear
// the exit before it has read the last of the output (#273). Node's own child process hears both
// in order: a reader that hands each chunk on late stands for the pipe the exit outran.
const late = () =>
  new Transform({
    transform(chunk: Buffer, _encoding, done) {
      setTimeout(() => {
        done(null, chunk);
      }, 20);
    },
  });

// A child read as main reads the engine (server-process.ts): Electron hands main each output as a
// stream of its own, and main relays every chunk it reads to its log.
function startChild(script: string) {
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = late();
  const stderr = late();
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  const relayed: string[] = [];
  stdout.on('data', (chunk: Buffer) => {
    relayed.push(...chunk.toString().trimEnd().split('\n'));
  });
  stderr.on('data', () => undefined);
  const exited = new Promise<number>((resolve) => {
    child.once('exit', (code) => {
      resolve(code ?? 1);
    });
  });
  return { relayed, exited, outputs: [stdout, stderr] };
}

describe('endOfProcess, with a real child process', () => {
  it('resolves once the last line the process wrote before exiting has been read', async () => {
    for (let run = 0; run < 5; run += 1) {
      const child = startChild(ENDS_LIKE_THE_ENGINE);

      const ended = await endOfProcess(child.exited, child.outputs, 5000);

      expect(ended).toBe(true);
      expect(child.relayed.at(-1)).toBe('stopped');
    }
  });

  it('gives up on an output still held open, within its bound after the exit', async () => {
    const child = startChild(LEAVES_ITS_OUTPUT_OPEN);
    const ending = endOfProcess(child.exited, child.outputs, 500);
    await child.exited;
    const exitedAt = performance.now();
    held.push(Number(child.relayed[0]));

    const ended = await ending;

    expect(ended).toBe(false);
    const waitedMs = performance.now() - exitedAt;
    expect(waitedMs).toBeGreaterThanOrEqual(450);
    expect(waitedMs).toBeLessThan(3000);
  });
});
