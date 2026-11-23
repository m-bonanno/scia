import { describe, expect, it, vi } from 'vitest';
import { supportPageOpener } from './support-page.ts';

describe('supportPageOpener', () => {
  it('opens the support page of Scia (#271)', async () => {
    const open = vi.fn(async (_url: string) => undefined);

    await supportPageOpener(open)();

    expect(open).toHaveBeenCalledExactlyOnceWith('https://ko-fi.com/notsosnake');
  });

  // The ask comes from the page: whatever it sends with it, main opens that address and no other.
  it('opens that address whatever the page sends with its ask', async () => {
    const open = vi.fn(async (_url: string) => undefined);

    await supportPageOpener(open)('https://elsewhere.example/', 'file:///C:/Windows/notepad.exe');

    expect(open).toHaveBeenCalledExactlyOnceWith('https://ko-fi.com/notsosnake');
  });

  it('says that it failed when the system opens nothing', async () => {
    const refusal = new Error('No browser.');

    await expect(supportPageOpener(() => Promise.reject(refusal))()).rejects.toBe(refusal);
  });
});
