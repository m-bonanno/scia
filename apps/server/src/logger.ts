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

export function describeFailure(error: unknown): object {
  if (!(error instanceof Error)) return { message: String(error) };
  const code = (error as NodeJS.ErrnoException).code;
  return {
    name: error.name,
    message: error.message,
    ...(code === undefined ? {} : { code }),
    ...(error.cause === undefined ? {} : { cause: describeFailure(error.cause) }),
  };
}
