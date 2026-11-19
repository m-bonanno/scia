import { DownloadStatus } from '@scia/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './app.tsx';
import type * as Live from '@/lib/live.ts';
import { ENGINE_UNREACHABLE } from '@/lib/messages.ts';
import { aDownload } from '@/test/a-download.ts';

vi.mock('@/lib/live.ts', async (original) => ({
  ...(await original<typeof Live>()),
  useLive: () => ({
    connection: 'live',
    downloads: [aDownload({ status: DownloadStatus.Completed })],
  }),
}));

afterEach(() => {
  delete window.scia;
});

describe('App', () => {
  it('says the file did not open, not that the engine is silent, when main cannot open it', async () => {
    const openDownload = vi.fn(async () => {
      throw new Error('Error invoking remote method: the file is not there');
    });
    window.scia = {
      apiToken: 'token',
      version: '1.0.0',
      platform: 'win32',
      revealDownload: vi.fn(async () => undefined),
      openDownload,
    };
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: 'Open' }));

    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent(
      'Scia could not open the file. It may have been moved or deleted.',
    );
    expect(notice).not.toHaveTextContent(ENGINE_UNREACHABLE);
    expect(openDownload).toHaveBeenCalledWith('d1');
  });
});
