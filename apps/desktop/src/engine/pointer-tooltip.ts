export interface PointerTooltipOptions {
  // What the tooltip reads when nothing was just read for it.
  readonly plain: string;
  // Asks what to say now; may take a moment, and may fail.
  readonly read: () => Promise<string>;
  readonly say: (text: string) => void;
}

// A tooltip that says something read on the spot, and only while the pointer is there to see
// it: an answer that comes back after the pointer has left, or for an earlier visit, is not
// said. Left on the icon, it would be a stale number for whoever reaches it another way.
export class PointerTooltip {
  readonly #options: PointerTooltipOptions;
  // Each arrival of the pointer is a visit; an answer belongs to the visit that asked for it.
  #visit = 0;
  #pointerIsOn = false;

  constructor(options: PointerTooltipOptions) {
    this.#options = options;
  }

  entered(): void {
    this.#visit += 1;
    this.#pointerIsOn = true;
    const visit = this.#visit;
    void this.#options.read().then(
      (text) => {
        if (this.#pointerIsOn && visit === this.#visit) this.#options.say(text);
      },
      () => undefined,
    );
  }

  left(): void {
    this.#pointerIsOn = false;
    this.#options.say(this.#options.plain);
  }
}
