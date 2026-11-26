import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom lays nothing out and has no ResizeObserver: nothing it would watch ever changes size.
class UnchangingSizes {
  observe(): void {
    // Nothing is ever measured.
  }
  unobserve(): void {
    // Nothing was watched.
  }
  disconnect(): void {
    // Nothing was watched.
  }
}
globalThis.ResizeObserver = UnchangingSizes;

afterEach(cleanup);

// The guard of a held Enter (`components/held-enter.ts`) lasts until the key is let go: a spec that
// failed while it held Enter would leave it armed for the specs after it.
afterEach(() => {
  fireEvent.keyUp(document.body, { key: 'Enter' });
});
