import { load, out, pointer } from 'koffi';

const WM_QUERYENDSESSION = 0x0011;
const WM_ENDSESSION = 0x0016;
// What lParam says of the end: nothing for a shutdown or a restart, ENDSESSION_LOGOFF for a
// sign-out, ENDSESSION_CLOSEAPP for an installer that needs the program's files (the Restart
// Manager's, and Scia's own installer's).
export const EndSession = { Shutdown: 0, Logoff: 0x8000_0000, CloseApp: 0x0001 } as const;
export type EndSession = (typeof EndSession)[keyof typeof EndSession];
// SendMessageTimeout's SMTO_ABORTIFHUNG, and a bound: a window that does not answer fails the spec.
const ABORT_IF_HUNG = 0x0002;
const MESSAGE_LIMIT_MS = 5000;
// Chromium's class for a top-level window: a BrowserWindow's, among others.
const WINDOW_CLASS = 'Chrome_WidgetWin_1';

// koffi answers a handle as a number, or as a bigint where it does not fit one.
type Handle = number | bigint;

function user32() {
  const library = load('user32.dll');
  const findWindow = library.func('__stdcall', 'FindWindowExW', 'uintptr_t', [
    'uintptr_t',
    'uintptr_t',
    'str16',
    'str16',
  ]) as (parent: Handle, after: Handle, windowClass: string, title: null) => Handle;
  const processOf = library.func('__stdcall', 'GetWindowThreadProcessId', 'uint32_t', [
    'uintptr_t',
    out(pointer('uint32_t')),
  ]) as (window: Handle, owner: [number]) => number;
  const send = library.func('__stdcall', 'SendMessageTimeoutW', 'intptr_t', [
    'uintptr_t',
    'uint32_t',
    'uintptr_t',
    'intptr_t',
    'uint32_t',
    'uint32_t',
    out(pointer('uintptr_t')),
  ]) as (
    window: Handle,
    message: number,
    wParam: number,
    lParam: number,
    flags: number,
    limitMs: number,
    result: [Handle],
  ) => Handle;
  return { findWindow, processOf, send };
}

// The top-level windows of a process, hidden ones included: Windows tells each when the session
// ends, a window put away in the tray too.
function windowsOf(pid: number, api: ReturnType<typeof user32>): Handle[] {
  const windows: Handle[] = [];
  for (
    let window = api.findWindow(0, 0, WINDOW_CLASS, null);
    BigInt(window) !== 0n;
    window = api.findWindow(0, window, WINDOW_CLASS, null)
  ) {
    const owner: [number] = [0];
    api.processOf(window, owner);
    if (owner[0] === pid) windows.push(window);
  }
  if (windows.length === 0) throw new Error(`Process ${String(pid)} has no window.`);
  return windows;
}

// Asks each window of the process whether the session may end, as Windows does before it ends
// it: true when every window says yes — a window that says no asks Windows to wait.
export function sessionMayEnd(pid: number, how: EndSession): boolean {
  const api = user32();
  return windowsOf(pid, api).every((window) => {
    const answer: [Handle] = [0];
    if (
      BigInt(
        api.send(window, WM_QUERYENDSESSION, 0, how, ABORT_IF_HUNG, MESSAGE_LIMIT_MS, answer),
      ) === 0n
    ) {
      throw new Error('WM_QUERYENDSESSION was not answered.');
    }
    return BigInt(answer[0]) !== 0n;
  });
}

// Tells each window of the process that the session ends, as Windows does at a shutdown or a
// sign-out, and as an installer that needs the program's files does.
export function endSessionOf(pid: number, how: EndSession): void {
  const api = user32();
  // A window the process closed while it ended, after an earlier one was told, answers nothing.
  const answered = windowsOf(pid, api).filter((window) => {
    const answer: [Handle] = [0];
    return (
      BigInt(api.send(window, WM_ENDSESSION, 1, how, ABORT_IF_HUNG, MESSAGE_LIMIT_MS, answer)) !==
      0n
    );
  });
  if (answered.length === 0) throw new Error('WM_ENDSESSION was not answered.');
}
