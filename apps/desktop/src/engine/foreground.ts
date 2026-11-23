import { win32 } from 'node:path';

// Which window Windows has in use (#62, ADR 0020). One PowerShell answers every question: it
// declares `GetForegroundWindow` once, says it is ready, then prints the window in use for every
// line it reads. Starting it and compiling the declaration takes seconds on a cold machine; a
// question to it takes milliseconds.
const SCRIPT = [
  'Add-Type -Namespace Scia -Name User32 -MemberDefinition',
  '\'[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();\';',
  "[Console]::Out.WriteLine('ready'); [Console]::Out.Flush();",
  'while ($null -ne [Console]::In.ReadLine()) {',
  '[Console]::Out.WriteLine([Scia.User32]::GetForegroundWindow().ToInt64()); [Console]::Out.Flush() }',
].join(' ');

export const READY = 'ready';

export interface ForegroundCommand {
  readonly file: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

// The system's own PowerShell, and nothing of main's environment: a question about a window needs
// none of it.
export function foregroundCommand(systemRoot: string): ForegroundCommand {
  return {
    file: win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoProfile', '-NonInteractive', '-Command', SCRIPT],
    env: { SystemRoot: systemRoot },
  };
}

export function handleFromLine(line: string): bigint | undefined {
  const text = line.trim();
  return /^\d+$/.test(text) ? BigInt(text) : undefined;
}

// A system that did not answer counts as another window in use: the product prefers a
// notification too many over one that never comes (the owner, #62).
export function windowInUse(foreground: bigint | undefined, own: bigint): boolean {
  return foreground !== undefined && foreground === own;
}
