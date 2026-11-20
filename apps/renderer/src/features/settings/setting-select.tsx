import { type ReactNode, useId } from 'react';
import { FOCUS_RING } from '@/components/button-styles.ts';
import { cn } from '@/lib/cn.ts';

export interface SettingOption {
  readonly value: string;
  readonly label: string;
}

interface SettingSelectProps {
  readonly label: string;
  readonly hint: string;
  readonly value: string;
  readonly options: readonly SettingOption[];
  readonly onChange: (value: string) => void;
}

// A setting chosen from ready values: nothing to type, so nothing to get wrong.
export function SettingSelect({
  label,
  hint,
  value,
  options,
  onChange,
}: SettingSelectProps): ReactNode {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium">
          {label}
        </label>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className={cn(
          'h-8 shrink-0 rounded-lg bg-tonal px-2 text-sm font-medium text-foreground tabular-nums',
          FOCUS_RING,
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
