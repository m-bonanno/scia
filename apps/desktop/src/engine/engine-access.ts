// How main reaches the engine it supervises: its address, main's own token, and a fetch.
export interface EngineAccess {
  readonly origin: string;
  readonly apiToken: string;
  readonly fetch: (
    url: string,
    init: { headers: Record<string, string>; signal?: AbortSignal },
  ) => Promise<Response>;
}
