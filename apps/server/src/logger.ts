export interface Logger {
  info(event: string, details?: object): void;
  warn(event: string, details?: object): void;
  error(event: string, details?: object): void;
}

// One JSON object per line: main copies the engine's output into its own log file.
export function createJsonLogger(
  write: (line: string) => void,
  now: () => Date = () => new Date(),
): Logger {
  const log = (level: string) => (event: string, details?: object) => {
    write(JSON.stringify({ time: now().toISOString(), level, event, ...details }));
  };
  return { info: log('info'), warn: log('warn'), error: log('error') };
}

// What a failure is, for a line of the log. A failure of the system's — a file, a socket, a
// program run — is said by its code and never by its message, which names the file or the command
// by its whole path, the person's account with it (#341, #267): main copies these lines into the
// log a person pastes into an issue.
export function describeFailure(error: unknown): object {
  if (!(error instanceof Error)) return { message: String(error) };
  const { code, syscall, killed, signal } = error as Partial<SystemFailure>;
  // A spawn's call names the program it could not start: `spawn <its whole path>`.
  if (syscall !== undefined) return { name: error.name, code, syscall: syscall.split(' ')[0] };
  if (killed !== undefined) return { name: error.name, code, killed, signal };
  return {
    name: error.name,
    message: error.message,
    ...(code === undefined ? {} : { code }),
    ...(error.cause === undefined ? {} : { cause: describeFailure(error.cause) }),
  };
}

// The one line the engine writes when it cannot start, before any logger exists: main copies it
// into its log like any other.
export function startFailedLine(error: unknown): string {
  return JSON.stringify({
    level: 'error',
    event: 'engine_start_failed',
    error: describeFailure(error),
  });
}

// Node's errors of a system call carry `syscall`; those of a program run, `killed` and `signal`.
interface SystemFailure {
  code: string | number;
  syscall: string;
  killed: boolean;
  signal: string | null;
}
