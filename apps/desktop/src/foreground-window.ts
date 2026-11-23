import { execFile } from 'node:child_process';
import { join } from 'node:path';

// Which window Windows has in use, asked of the system itself (#62, ADR 0020): Electron's
// `isFocused()` is what the window believes, and a window shown while another stays in use can
// believe it is focused. Electron has no call for it; PowerShell reaches `GetForegroundWindow`
// with no native module. Asked only when a notification is about to be decided, never on a timer.
const SCRIPT = [
  'Add-Type -Namespace Scia -Name User32 -MemberDefinition',
  '\'[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();\';',
  '[Scia.User32]::GetForegroundWindow().ToInt64()',
].join(' ');
const ASK_LIMIT_MS = 5000;

export function foregroundWindow(): Promise<bigint | undefined> {
  const systemRoot = process.env.SystemRoot;
  if (process.platform !== 'win32' || systemRoot === undefined) return Promise.resolve(undefined);
  const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve) => {
    execFile(
      powershell,
      ['-NoProfile', '-NonInteractive', '-Command', SCRIPT],
      // Built from nothing: main's environment is no business of a question about a window.
      { env: { SystemRoot: systemRoot }, timeout: ASK_LIMIT_MS, windowsHide: true },
      (error, stdout) => {
        const text = stdout.trim();
        resolve(error === null && /^\d+$/.test(text) ? BigInt(text) : undefined);
      },
    );
  });
}

// Electron gives a window's handle as the bytes of a pointer, in the machine's order.
export function handleOf(bytes: Buffer): bigint {
  return bytes.length >= 8 ? bytes.readBigUInt64LE(0) : BigInt(bytes.readUInt32LE(0));
}
