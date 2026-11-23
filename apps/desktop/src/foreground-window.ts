import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { foregroundCommand, handleFromLine, READY } from './engine/foreground.ts';

// Asks Windows which window is in use, through one PowerShell kept for as long as Scia runs
// (engine/foreground.ts, ADR 0020). It is started early (`warm`), because its first start takes
// seconds on a cold machine; a question asked before it is ready, or not answered within its
// limit, gets no answer, never a guess.
const ASK_LIMIT_MS = 1000;

export class ForegroundWindow {
  #child: ChildProcessWithoutNullStreams | undefined;
  #ready = false;
  #buffer = '';
  #waiting: ((line: string | undefined) => void)[] = [];
  #turn: Promise<unknown> = Promise.resolve();

  warm(): void {
    this.#running();
  }

  // One question at a time: each line the child prints answers the oldest waiting question.
  ask(limitMs = ASK_LIMIT_MS): Promise<bigint | undefined> {
    const asked = this.#turn.then(() => this.#askNow(limitMs));
    this.#turn = asked;
    return asked;
  }

  stop(): void {
    this.#child?.kill();
  }

  #askNow(limitMs: number): Promise<bigint | undefined> {
    const child = this.#running();
    if (child === undefined || !this.#ready) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const answer = (line: string | undefined) => {
        clearTimeout(timer);
        resolve(line === undefined ? undefined : handleFromLine(line));
      };
      // A late answer would be taken for the next question's: the child is ended, and started
      // again at the next question.
      const timer = setTimeout(() => {
        this.#waiting = this.#waiting.filter((waiting) => waiting !== answer);
        resolve(undefined);
        child.kill();
      }, limitMs);
      this.#waiting.push(answer);
      child.stdin.write('\n');
    });
  }

  #running(): ChildProcessWithoutNullStreams | undefined {
    const systemRoot = process.env.SystemRoot;
    if (process.platform !== 'win32' || systemRoot === undefined) return undefined;
    if (this.#child !== undefined) return this.#child;
    const command = foregroundCommand(systemRoot);
    const child = spawn(command.file, [...command.args], {
      env: { ...command.env },
      stdio: 'pipe',
      windowsHide: true,
    });
    this.#child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.#buffer += chunk;
      let end = this.#buffer.indexOf('\n');
      while (end >= 0) {
        const line = this.#buffer.slice(0, end).trim();
        this.#buffer = this.#buffer.slice(end + 1);
        if (line === READY) this.#ready = true;
        else this.#waiting.shift()?.(line);
        end = this.#buffer.indexOf('\n');
      }
    });
    const gone = () => {
      if (this.#child !== child) return;
      this.#child = undefined;
      this.#ready = false;
      this.#buffer = '';
      for (const waiting of this.#waiting.splice(0)) waiting(undefined);
    };
    child.on('error', gone);
    child.on('exit', gone);
    // A Scia that quits does not wait for it: its stdin closes with main, and its loop ends.
    child.unref();
    return child;
  }
}

// Electron gives a window's handle as the bytes of a pointer, in the machine's order.
export function handleOf(bytes: Buffer): bigint {
  return bytes.length >= 8 ? bytes.readBigUInt64LE(0) : BigInt(bytes.readUInt32LE(0));
}

// The one PowerShell of this Scia: started at boot by main, asked by the window.
export const foreground = new ForegroundWindow();
