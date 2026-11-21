import { ChevronDown } from 'lucide-react';
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
  const hintId = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium">
          {label}
        </label>
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      </div>
      {/* The system's arrow is not one of the app's icons: the menu draws lucide's, and its text
          starts where a field's and a text button's do (px-3). */}
      <div className="relative shrink-0">
        <select
          id={id}
          aria-describedby={hintId}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          className={cn(
            'h-8 cursor-pointer appearance-none rounded-lg bg-tonal pr-8 pl-3 text-sm font-medium text-foreground tabular-nums',
            FOCUS_RING,
          )}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    </div>
  );
}
