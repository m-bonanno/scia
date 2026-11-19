const BUCKET_MS = 100;
// A transfer one tenth of a second old would read as ten times its speed.
const MIN_SPAN_MS = 1000;

interface Bucket {
  readonly at: number;
  bytes: number;
}

// The speed over the last few seconds. The caller passes the time: no clock in the domain.
export class SpeedMeter {
  readonly #windowMs: number;
  #buckets: Bucket[] = [];
  #firstAt: number | undefined;

  constructor(windowMs = 3000) {
    this.#windowMs = windowMs;
  }

  record(bytes: number, atMs: number): void {
    this.#firstAt ??= atMs;
    const at = atMs - (atMs % BUCKET_MS);
    const last = this.#buckets.at(-1);
    if (last?.at === at) {
      last.bytes += bytes;
    } else {
      this.#buckets.push({ at, bytes });
    }
    this.#forgetBefore(atMs - this.#windowMs);
  }

  bytesPerSecond(nowMs: number): number {
    if (this.#firstAt === undefined) return 0;
    this.#forgetBefore(nowMs - this.#windowMs);
    const total = this.#buckets.reduce((sum, bucket) => sum + bucket.bytes, 0);
    const span = Math.min(this.#windowMs, Math.max(nowMs - this.#firstAt, MIN_SPAN_MS));
    return Math.round((total * 1000) / span);
  }

  #forgetBefore(limitMs: number): void {
    // A bucket stays while any of its tenth of a second is inside the window.
    const kept = this.#buckets.findIndex((bucket) => bucket.at + BUCKET_MS > limitMs);
    this.#buckets = kept === -1 ? [] : this.#buckets.slice(kept);
  }
}

// Null while the speed says nothing: a stalled transfer has no honest arrival time.
export function etaSeconds(remaining: number, bytesPerSecond: number): number | null {
  if (bytesPerSecond <= 0) return null;
  return Math.ceil(remaining / bytesPerSecond);
}
