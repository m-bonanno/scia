import type { Bundle } from '@scia/contracts';
import { BundleFailure, BundleStatus } from '@scia/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BundleRow } from './bundle-row.tsx';

const choosing: Bundle = {
  id: 'b1',
  name: 'Holiday films',
  status: BundleStatus.Choosing,
  failure: null,
  files: [
    { name: 'Day 1.mkv', size: 1024 },
    { name: 'Day 2.mkv', size: 2048 },
    { name: 'notes.nfo', size: 10 },
  ],
  unavailable: 0,
  createdAt: '2026-11-23T12:00:00.000Z',
};

function row(bundle: Bundle) {
  const actions = { start: vi.fn(), retry: vi.fn(), remove: vi.fn() };
  const view = render(
    <ul>
      <BundleRow bundle={bundle} actions={actions} />
    </ul>,
  );
  return { actions, view, item: within(screen.getByRole('listitem')) };
}

describe('BundleRow', () => {
  it('lists the files behind the link, all ticked, and downloads them all at one press', async () => {
    const { actions, item } = row(choosing);

    expect(item.getByText('Holiday films')).toBeInTheDocument();
    const files = item.getByRole('group', { name: 'Files of Holiday films' });
    for (const name of ['Day 1.mkv', 'Day 2.mkv', 'notes.nfo']) {
      expect(within(files).getByRole('checkbox', { name: new RegExp(name) })).toBeChecked();
    }
    await userEvent.click(item.getByRole('button', { name: 'Download 3 files' }));

    expect(actions.start).toHaveBeenCalledExactlyOnceWith('b1', [0, 1, 2]);
  });

  it('downloads only the files left ticked', async () => {
    const { actions, item } = row(choosing);

    await userEvent.click(item.getByRole('checkbox', { name: /Day 2\.mkv/ }));
    await userEvent.click(item.getByRole('button', { name: 'Download 2 files' }));

    expect(actions.start).toHaveBeenCalledExactlyOnceWith('b1', [0, 2]);
  });

  it('ticks and unticks every file at once, and says when only some are ticked', async () => {
    const { actions, item } = row(choosing);
    const all = item.getByRole('checkbox', { name: 'All files' });

    await userEvent.click(all);
    for (const box of item.getAllByRole('checkbox').filter((each) => each !== all)) {
      expect(box).not.toBeChecked();
    }
    expect(item.getByRole('button', { name: 'Download' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(item.getByRole('button', { name: 'Download' }));
    expect(actions.start).not.toHaveBeenCalled();

    await userEvent.click(item.getByRole('checkbox', { name: /notes\.nfo/ }));
    expect((all as HTMLInputElement).indeterminate).toBe(true);
    await userEvent.click(all);
    expect(item.getByRole('button', { name: 'Download 3 files' })).not.toHaveAttribute(
      'aria-disabled',
    );
  });

  it('says one file in the singular', async () => {
    const { item } = row(choosing);

    await userEvent.click(item.getByRole('checkbox', { name: /Day 1\.mkv/ }));
    await userEvent.click(item.getByRole('checkbox', { name: /Day 2\.mkv/ }));

    expect(item.getByRole('button', { name: 'Download 1 file' })).toBeInTheDocument();
  });

  it('starts the files once, however often Download is pressed', async () => {
    const { actions, item } = row(choosing);

    await userEvent.dblClick(item.getByRole('button', { name: 'Download 3 files' }));
    item.getByRole('button', { name: 'Download 3 files' }).focus();
    await userEvent.keyboard('{Enter>4/}');

    expect(actions.start).toHaveBeenCalledTimes(2);
  });

  it('says what each file weighs beside its name', () => {
    const { item } = row(choosing);

    expect(item.getByRole('checkbox', { name: /Day 2\.mkv/ })).toHaveAccessibleName(
      expect.stringContaining('2'),
    );
  });

  it('says it is asking the service, on a bar that does not know how far, with nothing to tick', () => {
    const { item } = row({ ...choosing, status: BundleStatus.Opening, files: [] });

    expect(item.getByText('Opening through AllDebrid…')).toBeInTheDocument();
    expect(item.getByRole('progressbar', { name: 'Opened by AllDebrid' })).not.toHaveAttribute(
      'aria-valuenow',
    );
    expect(item.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(item.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  const refused: Bundle = {
    ...choosing,
    status: BundleStatus.Failed,
    failure: BundleFailure.Refused,
    files: [],
  };

  it('says why it gave no files, and offers Retry once however often it is pressed', async () => {
    const { actions, item } = row(refused);

    expect(item.getByText('AllDebrid could not open this link.')).toBeInTheDocument();
    await userEvent.dblClick(item.getByRole('button', { name: 'Retry' }));

    expect(actions.retry).toHaveBeenCalledExactlyOnceWith('b1');
    expect(item.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('hands the focus to Remove when Retry leaves under its press', async () => {
    const { item } = row(refused);

    await userEvent.click(item.getByRole('button', { name: 'Retry' }));

    expect(item.getByRole('button', { name: 'Remove' })).toHaveFocus();
  });

  it('forgets it at Remove, in every state', async () => {
    for (const status of [BundleStatus.Opening, BundleStatus.Choosing]) {
      const { actions, item, view } = row({ ...choosing, status });
      await userEvent.click(item.getByRole('button', { name: 'Remove' }));
      expect(actions.remove).toHaveBeenCalledExactlyOnceWith('b1');
      view.unmount();
    }
  });
});
