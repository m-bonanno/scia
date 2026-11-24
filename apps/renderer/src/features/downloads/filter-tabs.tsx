import { type ReactNode, type Ref, useImperativeHandle, useRef } from 'react';
import { cn } from '@/lib/cn.ts';
import { formatCount } from '@/lib/format.ts';
import { Filter, FILTER_LABELS } from './filters.ts';

export interface FilterTabsHandle {
  // The focus, on the filter in use: for a control beside the tabs that leaves under it.
  focus(): void;
}

interface FilterTabsProps {
  readonly filter: Filter;
  readonly counts: Readonly<Record<Filter, number>>;
  readonly onChange: (filter: Filter) => void;
  readonly ref?: Ref<FilterTabsHandle>;
}

export function FilterTabs({ filter, counts, onChange, ref }: FilterTabsProps): ReactNode {
  const selected = useRef<HTMLButtonElement>(null);
  // Made once: a handle made again at every drawing is let go while React walks the tabs, and a
  // control beside them that leaves in the same drawing would find none.
  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        selected.current?.focus();
      },
    }),
    [],
  );
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Filter downloads">
      {Object.values(Filter).map((option) => (
        <button
          key={option}
          ref={option === filter ? selected : undefined}
          type="button"
          aria-pressed={option === filter}
          onClick={() => {
            onChange(option);
          }}
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-colors',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            option === filter
              ? 'bg-tonal text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {FILTER_LABELS[option]}
          <span className="text-muted-foreground tabular-nums">{formatCount(counts[option])}</span>
        </button>
      ))}
    </div>
  );
}
