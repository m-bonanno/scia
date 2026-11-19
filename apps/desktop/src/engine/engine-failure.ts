export const EngineFailure = {
  // The first start: the engine exited, or said nothing in time.
  NeverStarted: 'never-started',
  // It started, exited by itself, and starting it again stopped being worth trying.
  KeepsStopping: 'keeps-stopping',
} as const;
export type EngineFailure = (typeof EngineFailure)[keyof typeof EngineFailure];

export interface EngineFailureDetails {
  readonly port: number;
  readonly logPath: string;
}

export interface EngineFailureNotice {
  readonly title: string;
  readonly body: string;
}

// What the person is told when Scia gives up on its engine: the fact, and a remedy only where
// one is known. A taken port stops a first start; nothing is known of an engine that keeps
// stopping but what the log says.
export function engineFailureNotice(
  failure: EngineFailure,
  details: EngineFailureDetails,
): EngineFailureNotice {
  const log = `Technical details: ${details.logPath}`;
  if (failure === EngineFailure.NeverStarted) {
    return {
      title: 'Scia cannot start',
      body: `The download engine did not start. If another program is using port ${String(details.port)}, close it and open Scia again.\n\n${log}`,
    };
  }
  return {
    title: 'Scia has to close',
    body: `The download engine keeps stopping, and Scia gave up starting it again. Open Scia again.\n\n${log}`,
  };
}
