// Electron's channel to the process that forked this one; absent under plain Node.
export interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { readonly data: unknown }) => void): void;
}

export function parentPort(): ParentPort | undefined {
  return (process as { parentPort?: ParentPort }).parentPort;
}
