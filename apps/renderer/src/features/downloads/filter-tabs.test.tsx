import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilterTabs } from './filter-tabs.tsx';
import { Filter } from './filters.ts';
import { formatCount } from '@/lib/format.ts';

describe('FilterTabs', () => {
  it('writes its counts as every number of the page is written, beside "Clear 12,345 completed"', () => {
    render(
      <FilterTabs
        filter={Filter.All}
        counts={{ all: 12_346, active: 1, completed: 12_345 }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /^Completed/ })).toHaveTextContent(
      `Completed${formatCount(12_345)}`,
    );
    expect(formatCount(12_345)).not.toBe('12345');
  });
});
