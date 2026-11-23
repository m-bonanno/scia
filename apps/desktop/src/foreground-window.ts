// Which window Windows has in use (#62, ADR 0020), asked of the system itself: Electron's
// `isFocused()` is what the window believes, and a window shown while another stays in use can
// believe it is focused. Electron has no call for it; koffi calls `GetForegroundWindow` in user32,
// in microseconds, with no process beside Scia. Loaded on Windows only, at boot; a koffi that
// cannot be loaded, or a call that throws, gives no answer, never a guess.
type ForegroundCall = () => number | bigint;

interface Koffi {
  load(library: string): {
    func(convention: string, name: string, result: string, args: string[]): ForegroundCall;
  };
}

let call: ForegroundCall | undefined;

// What became of the loading, for main's log: a koffi that does not load must be seen, since
// without it every decision notifies.
export type ForegroundLoad =
  { readonly loaded: true } | { readonly loaded: false; readonly error: string };

export async function loadForeground(): Promise<ForegroundLoad | undefined> {
  if (process.platform !== 'win32') return undefined;
  if (call !== undefined) return { loaded: true };
  try {
    // Kept outside main's bundle: koffi finds its native build beside its own files.
    const koffi = ((await import('koffi')) as { default: Koffi }).default;
    call = koffi.load('user32.dll').func('__stdcall', 'GetForegroundWindow', 'uintptr_t', []);
    return { loaded: true };
  } catch (error) {
    call = undefined;
    return { loaded: false, error: String(error).split('\n')[0] ?? '' };
  }
}

export function foregroundWindow(): bigint | undefined {
  if (call === undefined) return undefined;
  try {
    return BigInt(call());
  } catch {
    return undefined;
  }
}

// Electron gives a window's handle as the bytes of a pointer, in the machine's order.
export function handleOf(bytes: Buffer): bigint {
  return bytes.length >= 8 ? bytes.readBigUInt64LE(0) : BigInt(bytes.readUInt32LE(0));
}
