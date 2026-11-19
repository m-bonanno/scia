import type { ReactNode } from 'react';
import { cn } from '@/lib/cn.ts';
import { Filter, FILTER_LABELS } from './filters.ts';

interface FilterTabsProps {
  readonly filter: Filter;
  readonly counts: Readonly<Record<Filter, number>>;
  readonly onChange: (filter: Filter) => void;
}

export function FilterTabs({ filter, counts, onChange }: FilterTabsProps): ReactNode {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Filtra i download">
      {Object.values(Filter).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === filter}
          onClick={() => {
            onChange(option);
          }}
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            option === filter
              ? 'bg-tonal text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {FILTER_LABELS[option]}
          <span className="text-muted-foreground tabular-nums">{counts[option]}</span>
        </button>
      ))}
    </div>
  );
}
