import { describe, expect, it } from 'vitest';
import { DownloadStatus } from './download.ts';
import { nextToStart } from './queue.ts';

describe('nextToStart', () => {
  it('fills the free slots in the order of the queue', () => {
    const queue = [
      { id: 'a', status: DownloadStatus.Downloading },
      { id: 'b', status: DownloadStatus.Queued },
      { id: 'c', status: DownloadStatus.Paused },
      { id: 'd', status: DownloadStatus.Queued },
      { id: 'e', status: DownloadStatus.Queued },
    ];
    expect(nextToStart(queue, 3)).toEqual(['b', 'd']);
  });

  it('starts nothing while every slot is taken', () => {
    const queue = [
      { id: 'a', status: DownloadStatus.Downloading },
      { id: 'b', status: DownloadStatus.Queued },
    ];
    expect(nextToStart(queue, 1)).toEqual([]);
    expect(nextToStart(queue, 0)).toEqual([]);
  });
});
