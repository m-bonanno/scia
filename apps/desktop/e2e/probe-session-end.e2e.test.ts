import { load, out, pointer } from 'koffi';
import { describe, expect, it } from 'vitest';
import { useRun } from './scia.ts';
import { EndSession, endSessionOf } from './session-end.ts';

// A throwaway probe of #262's round 1, removed in the next commit: what ends Scia's main at the end
// of a session — Electron's own `TerminateCurrentProcessImmediately(0)` after `session-end`, when
// `Browser::is_quitting()` is false (shell/browser/native_window_views_win.cc, v44.10.1) — read as
// main's exit code, and whether `will-quit` or `quit` came first.
const SYNCHRONIZE = 0x0010_0000;
const QUERY_LIMITED = 0x1000;

describe('probe: the end of a session in the real app', () => {
  const run = useRun();

  it('reads how main ends after WM_ENDSESSION', async () => {
    const profile = await run.profile();
    const scia = await run.launch(profile);
    const pid = await scia.app.evaluate(() => process.pid);
    const kernel32 = load('kernel32.dll');
    const openProcess = kernel32.func('__stdcall', 'OpenProcess', 'uintptr_t', [
      'uint32_t',
      'int',
      'uint32_t',
    ]) as (access: number, inherit: number, pid: number) => number | bigint;
    const waitFor = kernel32.func('__stdcall', 'WaitForSingleObject', 'uint32_t', [
      'uintptr_t',
      'uint32_t',
    ]) as (handle: number | bigint, ms: number) => number;
    const exitCodeOf = kernel32.func('__stdcall', 'GetExitCodeProcess', 'int', [
      'uintptr_t',
      out(pointer('uint32_t')),
    ]) as (handle: number | bigint, code: [number]) => number;
    const handle = openProcess(SYNCHRONIZE | QUERY_LIMITED, 0, pid);
    expect(BigInt(handle)).not.toBe(0n);

    const started = performance.now();
    endSessionOf(pid, EndSession.Shutdown);
    const waited = waitFor(handle, 30_000);
    const tookMs = Math.round(performance.now() - started);
    const code: [number] = [-1];
    exitCodeOf(handle, code);

    const log = await profile.log();
    const seen = {
      waited,
      code: code[0],
      tookMs,
      sessionEnded: log.includes('session_ended'),
      willQuit: log.includes('probe_will_quit'),
      quitEvent: log.includes('probe_quit'),
      // Quit's own last line, `quit` alone, written before `app.exit(0)`.
      quitLine: /\squit\s*$/m.test(log),
    };
    console.warn(`PROBE ${JSON.stringify(seen)}`);
    expect(seen).toMatchObject({
      waited: 0,
      code: 0,
      sessionEnded: true,
      willQuit: false,
      quitEvent: false,
      quitLine: false,
    });
  });
});
