import { type ReactNode, useId } from 'react';
import { FOCUS_RING } from '@/components/button-styles.ts';
import { cn } from '@/lib/cn.ts';
import { formatSpeed } from '@/lib/format.ts';

const KIB = 1024;
const MIB = 1024 * KIB;
// The values a person chooses from: no number to type, so none to get wrong. The engine takes
// any whole number above its floor; one it has that is not here is shown among these.
const READY_LIMITS: readonly number[] = [
  256 * KIB,
  512 * KIB,
  MIB,
  2 * MIB,
  5 * MIB,
  10 * MIB,
  25 * MIB,
  50 * MIB,
];
const NO_LIMIT = 'none';

interface SpeedLimitProps {
  // Bytes per second, for all downloads together; null for none.
  readonly value: number | null;
  readonly onChange: (value: number | null) => void;
}

export function SpeedLimit({ value, onChange }: SpeedLimitProps): ReactNode {
  const id = useId();
  const limits =
    value === null || READY_LIMITS.includes(value)
      ? READY_LIMITS
      : [...READY_LIMITS, value].toSorted((a, b) => a - b);
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium">
          Speed limit
        </label>
        <p className="text-sm text-muted-foreground">For all downloads together.</p>
      </div>
      <select
        id={id}
        value={value === null ? NO_LIMIT : String(value)}
        onChange={(event) => {
          onChange(event.target.value === NO_LIMIT ? null : Number(event.target.value));
        }}
        className={cn(
          'h-8 shrink-0 rounded-lg bg-tonal px-2 text-sm font-medium text-foreground tabular-nums',
          FOCUS_RING,
        )}
      >
        <option value={NO_LIMIT}>No limit</option>
        {limits.map((limit) => (
          <option key={limit} value={limit}>
            {formatSpeed(limit)}
          </option>
        ))}
      </select>
    </div>
  );
}
