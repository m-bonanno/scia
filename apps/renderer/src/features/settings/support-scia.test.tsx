import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SciaBridge } from '@/lib/bridge.ts';
import { SupportScia } from './support-scia.tsx';

describe('SupportScia', () => {
  let openSupportPage: ReturnType<typeof vi.fn<SciaBridge['openSupportPage']>>;

  beforeEach(() => {
    openSupportPage = vi.fn<SciaBridge['openSupportPage']>(async () => undefined);
    window.scia = {
      apiToken: 'token',
      version: '1.0.0',
      platform: 'win32',
      revealDownload: vi.fn(async () => undefined),
      openDownload: vi.fn(async () => undefined),
      chooseDownloadFolder: vi.fn(async () => 'kept'),
      themeChanged: vi.fn(async () => undefined),
      updateOffered: vi.fn(async () => null),
      onUpdateChanged: vi.fn(() => () => undefined),
      restartToUpdate: vi.fn(async () => 'nothing'),
      openCodePage: vi.fn(async () => undefined),
      openSupportPage,
    };
  });
  afterEach(() => {
    delete window.scia;
  });

  it('asks main to open the support page, naming nothing', async () => {
    render(<SupportScia open />);

    await userEvent.click(screen.getByRole('button', { name: 'Support Scia' }));

    expect(openSupportPage).toHaveBeenCalledExactlyOnceWith();
  });

  it('opens one page for a double click', () => {
    render(<SupportScia open />);
    const support = screen.getByRole('button', { name: 'Support Scia' });

    fireEvent.click(support, { detail: 1 });
    fireEvent.click(support, { detail: 2 });

    expect(openSupportPage).toHaveBeenCalledOnce();
  });

  it('opens one page for Enter held down', async () => {
    render(<SupportScia open />);
    screen.getByRole('button', { name: 'Support Scia' }).focus();

    await userEvent.keyboard('{Enter>5/}');

    expect(openSupportPage).toHaveBeenCalledOnce();
  });

  it('says where the page is when main could not open it', async () => {
    openSupportPage.mockRejectedValue(new Error('No browser.'));
    render(<SupportScia open />);

    await userEvent.click(screen.getByRole('button', { name: 'Support Scia' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Scia could not open the page. Go to ko-fi.com/notsosnake.',
    );
  });

  it('forgets that it could not open the page at the next press', async () => {
    openSupportPage.mockRejectedValueOnce(new Error('No browser.'));
    render(<SupportScia open />);
    const support = screen.getByRole('button', { name: 'Support Scia' });
    await userEvent.click(support);
    await screen.findByRole('alert');

    await userEvent.click(support);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // Settings stays mounted: what one visit said does not greet the next.
  it('forgets that it could not open the page when Settings closes and opens again', async () => {
    openSupportPage.mockRejectedValue(new Error('No browser.'));
    const { rerender } = render(<SupportScia open />);
    await userEvent.click(screen.getByRole('button', { name: 'Support Scia' }));
    await screen.findByRole('alert');

    rerender(<SupportScia open={false} />);
    rerender(<SupportScia open />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('is not offered in a plain browser, which has no main to open the page', () => {
    delete window.scia;
    render(<SupportScia open />);

    expect(screen.queryByRole('button', { name: 'Support Scia' })).not.toBeInTheDocument();
  });
});
