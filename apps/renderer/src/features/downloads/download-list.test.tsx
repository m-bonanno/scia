import { DownloadStatus } from '@scia/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DownloadList } from './download-list.tsx';
import type { RowActions } from './download-row.tsx';
import { Filter } from './filters.ts';
import { aDownload } from '@/test/a-download.ts';

const finished = (id: string) =>
  aDownload({ id, fileName: `${id}.pdf`, status: DownloadStatus.Completed });

describe('DownloadList', () => {
  it('takes one finished row at each quick press on the same spot, as the rows slide under it', () => {
    const remove = vi.fn();
    const actions: RowActions = {
      start: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      remove,
      reveal: undefined,
      open: undefined,
    };
    const list = (ids: string[]) => (
      <DownloadList
        downloads={ids.map(finished)}
        filter={Filter.Completed}
        actions={actions}
        magnets={[]}
        magnetActions={{ retry: vi.fn(), remove: vi.fn() }}
        bundles={[]}
        bundleActions={{ start: vi.fn(), retry: vi.fn(), remove: vi.fn() }}
      />
    );
    const topCross = () => screen.getAllByRole('button', { name: 'Remove from list' })[0]!;
    const { rerender } = render(list(['one', 'two', 'three']));

    // The pointer does not move: each press says it is one more of the same burst, and lands
    // on the cross of the row that came up.
    fireEvent.click(topCross(), { detail: 1 });
    rerender(list(['two', 'three']));
    fireEvent.click(topCross(), { detail: 2 });
    rerender(list(['three']));
    fireEvent.click(topCross(), { detail: 3 });

    expect(remove.mock.calls).toEqual([['one'], ['two'], ['three']]);
  });
});
