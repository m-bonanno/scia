import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
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
