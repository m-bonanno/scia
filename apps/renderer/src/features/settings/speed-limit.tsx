import type { ReactNode } from 'react';
import { formatSpeed } from '@/lib/format.ts';
import { SettingSelect } from './setting-select.tsx';

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
  const limits =
    value === null || READY_LIMITS.includes(value)
      ? READY_LIMITS
      : [...READY_LIMITS, value].toSorted((a, b) => a - b);
  return (
    <SettingSelect
      label="Speed limit"
      hint="For all downloads together."
      value={value === null ? NO_LIMIT : String(value)}
      options={[
        { value: NO_LIMIT, label: 'No limit' },
        ...limits.map((limit) => ({ value: String(limit), label: formatSpeed(limit) })),
      ]}
      onChange={(chosen) => {
        onChange(chosen === NO_LIMIT ? null : Number(chosen));
      }}
    />
  );
}
