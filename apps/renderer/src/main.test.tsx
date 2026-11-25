import { act } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("starts the page with zod making no function from text, which the page's policy refuses (#61)", async () => {
  // Zod asks with `new Function("")` as it builds its first schema of an object, which loading the
  // page's modules does, and compiles its checks the same way at a parse. Only zod's calls are
  // counted: jsdom's selectors are made the same way, and the page has no jsdom.
  const original = Function;
  const callers: string[] = [];
  vi.spyOn(globalThis, 'Function').mockImplementation(function (...body: string[]) {
    callers.push(new Error().stack ?? '');
    return Reflect.construct(original, body) as () => unknown;
  });
  vi.stubGlobal('fetch', () => new Promise(() => undefined));
  document.body.innerHTML = '<div id="root"></div>';

  await act(async () => {
    await import('./main.tsx');
  });

  expect(callers.filter((stack) => stack.includes('/zod/'))).toEqual([]);
});
