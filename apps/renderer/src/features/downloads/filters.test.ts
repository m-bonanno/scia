import { DownloadStatus } from '@scia/core';
import { describe, expect, it } from 'vitest';
import { countByFilter, Filter, matchesFilter } from './filters.ts';
import { aDownload } from '@/test/a-download.ts';

describe('the filters of the list', () => {
  it('count a paused or failed download as still in progress', () => {
    expect(matchesFilter(Filter.Active, DownloadStatus.Paused)).toBe(true);
    expect(matchesFilter(Filter.Active, DownloadStatus.Failed)).toBe(true);
    expect(matchesFilter(Filter.Active, DownloadStatus.Completed)).toBe(false);
    expect(matchesFilter(Filter.Completed, DownloadStatus.Completed)).toBe(true);
    expect(matchesFilter(Filter.All, DownloadStatus.Queued)).toBe(true);
  });

  it('count what each tab will show', () => {
    const downloads = [
      aDownload({ id: 'a' }),
      aDownload({ id: 'b', status: DownloadStatus.Completed }),
      aDownload({ id: 'c', status: DownloadStatus.Failed }),
    ];
    expect(countByFilter(downloads)).toEqual({ all: 3, active: 2, completed: 1 });
  });

  it('count a magnet the service is fetching in "All" and in "In progress", never among the completed', () => {
    expect(countByFilter([aDownload({ status: DownloadStatus.Completed })], 2)).toEqual({
      all: 3,
      active: 2,
      completed: 1,
    });
  });
});
