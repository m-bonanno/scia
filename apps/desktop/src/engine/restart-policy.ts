export interface RestartLimits {
  // Failures in a row before giving up.
  readonly maxFailures: number;
  // An engine that ran this long was healthy: its exit starts a new count.
  readonly healthyAfterMs: number;
  readonly firstDelayMs: number;
  readonly longestDelayMs: number;
}

export const DEFAULT_RESTART_LIMITS: RestartLimits = {
  maxFailures: 5,
  healthyAfterMs: 60_000,
  firstDelayMs: 500,
  longestDelayMs: 10_000,
};

// How long to wait before starting the engine again after it exited by itself, or that it is
// time to stop trying and tell the person.
export class RestartPolicy {
  readonly #limits: RestartLimits;
  #failures = 0;

  constructor(limits: RestartLimits = DEFAULT_RESTART_LIMITS) {
    this.#limits = limits;
  }

  // Null: give up.
  next(ranForMs: number): number | null {
    this.#failures = ranForMs >= this.#limits.healthyAfterMs ? 1 : this.#failures + 1;
    if (this.#failures > this.#limits.maxFailures) return null;
    return Math.min(
      this.#limits.longestDelayMs,
      this.#limits.firstDelayMs * 2 ** (this.#failures - 1),
    );
  }
}
